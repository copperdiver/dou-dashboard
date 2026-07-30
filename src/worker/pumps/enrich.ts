import { eq, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import {
  llmCache,
  reasonCategories,
  reasons,
  reasonTextReasons,
  reasonTexts,
} from '../../db/schema'
import { createEnricher, type EnrichResult } from '../../lib/llm'
import { analyzeReasonText } from '../../lib/reasons/canonize'
import { reasonDedupKey } from '../../lib/reasons/normalize'
import { RULES_VERSION } from '../../lib/reasons/rules'
import { sha256Hex } from '../../lib/text'
import { syncDenialReasons } from './canonize'
import type { Pump } from './types'

/**
 * Обогащение остатка через LLM.
 *
 * Берёт только тексты, которые правила не разобрали (по замеру — 6%),
 * и только непокрытую их часть. Ответ кешируется в `llm_cache` по хешу
 * входа, поэтому переразбор и повторные прогоны бесплатны.
 *
 * Пачка маленькая: у очереди `dou-llm` concurrency 1, и это же снимает
 * весь класс гонок при создании канонических причин — распараллеливать
 * тут нечего.
 */

const BATCH = 5

type Claim = { id: string; textRaw: string }

async function claimTexts(limit: number): Promise<Claim[]> {
  const result = await db.execute<Claim>(sql`
    with candidates as (
      select id
      from ${reasonTexts}
      where review_state = 'needs_review'
        and rules_version >= ${RULES_VERSION}
      order by occurrences desc
      limit ${limit}
      for update skip locked
    )
    update ${reasonTexts} t
       set review_state = 'auto'
      from candidates c
     where t.id = c.id
    returning t.id, t.text_raw as "textRaw"
  `)

  return result.rows
}

export const enrichReasons: Pump = async ({ log }) => {
  const claims = await claimTexts(BATCH)
  if (claims.length === 0) return { itemsProcessed: 0, meta: { texts: 0 } }

  const enricher = createEnricher()

  const [knownRows, categoryRows] = await Promise.all([
    db
      .select({
        id: reasons.id,
        slug: reasons.slug,
        textPt: reasons.textPt,
        categoryId: reasons.categoryId,
      })
      .from(reasons),
    db
      .select({ id: reasonCategories.id, code: reasonCategories.code, nameEn: reasonCategories.nameEn })
      .from(reasonCategories),
  ])

  const categoryById = new Map(categoryRows.map((c) => [c.id, c.code]))
  const categoryIdByCode = new Map(categoryRows.map((c) => [c.code, c.id]))
  const known = knownRows.map((r) => ({
    slug: r.slug,
    textPt: r.textPt,
    categoryCode: categoryById.get(r.categoryId) ?? 'unclear',
  }))
  const categories = categoryRows.map((c) => ({ code: c.code, nameEn: c.nameEn }))

  let enriched = 0
  let fromCache = 0
  let created = 0
  let stillUnresolved = 0

  for (const claim of claims) {
    const analysis = analyzeReasonText(claim.textRaw)
    const remainder = analysis.remainder.length > 0 ? analysis.remainder : claim.textRaw

    const inputSha256 = sha256Hex(`${enricher.promptVersion}\n${remainder}`)

    const [cached] = await db
      .select({ response: llmCache.response })
      .from(llmCache)
      .where(
        sql`${llmCache.promptVersion} = ${enricher.promptVersion} and ${llmCache.inputSha256} = ${inputSha256}`,
      )

    let result: EnrichResult
    if (cached) {
      result = cached.response as unknown as EnrichResult
      fromCache += 1
    } else {
      result = await enricher.enrich({ remainder, known, categories })
      // Кешируем только полезный результат: отказ и сбой повторить стоит.
      if (!result.needsReview) {
        await db
          .insert(llmCache)
          .values({
            promptVersion: enricher.promptVersion,
            inputSha256,
            response: result as unknown as Record<string, unknown>,
            model: result.model,
          })
          .onConflictDoNothing()
      }
    }

    if (result.needsReview) {
      stillUnresolved += 1
      await db
        .update(reasonTexts)
        .set({ reviewState: 'needs_review', classifiedAt: new Date() })
        .where(eq(reasonTexts.id, claim.id))
      log(`${claim.id.slice(0, 8)}: ${result.reviewReason ?? 'провайдер не дал результата'}`)
      continue
    }

    await db.transaction(async (tx) => {
      const matched: { reasonId: string; categoryId: number }[] = []

      for (const slug of result.matchedSlugs) {
        const row = knownRows.find((r) => r.slug === slug)
        if (row) matched.push({ reasonId: row.id, categoryId: row.categoryId })
      }

      for (const candidate of result.newReasons) {
        const categoryId = categoryIdByCode.get(candidate.categoryCode)
        if (categoryId === undefined) continue

        const normalizedKey = reasonDedupKey(candidate.textPt).textNorm
        if (normalizedKey.length < 8) continue

        // Апсерт по normalized_key: две параллельные записи одной и той же
        // причины не создадут дубля даже если concurrency вырастет.
        const slug = `llm-${sha256Hex(normalizedKey).slice(0, 12)}`

        await tx
          .insert(reasons)
          .values({
            slug,
            normalizedKey,
            textPt: candidate.textPt,
            textEn: candidate.textEn || null,
            textRu: candidate.textRu || null,
            categoryId,
            status: 'draft',
            source: 'llm',
            llmModel: result.model,
            promptVersion: result.promptVersion,
          })
          .onConflictDoNothing({ target: reasons.normalizedKey })

        const [row] = await tx
          .select({ id: reasons.id, categoryId: reasons.categoryId })
          .from(reasons)
          .where(eq(reasons.normalizedKey, normalizedKey))

        if (row) {
          matched.push({ reasonId: row.id, categoryId: row.categoryId })
          created += 1
        }
      }

      for (const match of matched) {
        await tx
          .insert(reasonTextReasons)
          .values({
            reasonTextId: claim.id,
            reasonId: match.reasonId,
            method: 'llm',
            confidence: '0.800',
            rulesVersion: RULES_VERSION,
          })
          .onConflictDoNothing()
      }

      await tx
        .update(reasonTexts)
        // Новые причины приходят в status='draft': их стоит просмотреть,
        // но текст уже классифицирован и в отчёте непонятых не висит.
        .set({ reviewState: 'auto', classifiedAt: new Date() })
        .where(eq(reasonTexts.id, claim.id))

      await syncDenialReasons(tx, claim.id, matched)
      enriched += 1
    })
  }

  log(
    `провайдер ${enricher.name}/${enricher.model}: текстов ${claims.length}, ` +
      `обогащено ${enriched}, из кеша ${fromCache}, новых причин ${created}, ` +
      `осталось непонятыми ${stillUnresolved}`,
  )

  return {
    itemsProcessed: claims.length,
    meta: {
      texts: claims.length,
      provider: enricher.name,
      model: enricher.model,
      enriched,
      fromCache,
      createdReasons: created,
      stillUnresolved,
    },
  }
}
