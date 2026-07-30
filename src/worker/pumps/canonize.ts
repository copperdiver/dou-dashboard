import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import {
  denialReasons,
  denials,
  dirtyDays,
  reasonCategories,
  reasons,
  reasonTextReasons,
  reasonTexts,
} from '../../db/schema'
import { analyzeReasonText } from '../../lib/reasons/canonize'
import { RULES_VERSION } from '../../lib/reasons/rules'
import { pipelineConfig } from '../../lib/env'
import type { Pump } from './types'

/**
 * Канонизация текстов причин детерминированными средствами.
 *
 * Работает по УНИКАЛЬНЫМ текстам (`reason_texts`), а не по отказам:
 * замер даёт 203 уникальных текста на 267 отказов, и правила с LLM
 * должны видеть каждый текст один раз.
 *
 * Правила и декодер правовых ссылок покрывают 94% текстов. Остаток
 * помечается `needs_review` и достаётся насосу enrich.
 *
 * Ручные правки не затираются: тексты в состоянии `confirmed`/`corrected`
 * автоматика не берёт, а связи с `method='manual'` при перезаписи
 * сохраняются.
 */

type Claim = {
  id: string
  textRaw: string
}

async function claimTexts(limit: number): Promise<Claim[]> {
  const result = await db.execute<Claim>(sql`
    with candidates as (
      select id
      from ${reasonTexts}
      where rules_version < ${RULES_VERSION}
        and review_state in ('auto', 'needs_review')
      order by occurrences desc
      limit ${limit}
      for update skip locked
    )
    update ${reasonTexts} t
       set classified_at = now()
      from candidates c
     where t.id = c.id
    returning t.id, t.text_raw as "textRaw"
  `)

  return result.rows
}

export const canonizeReasons: Pump = async ({ log }) => {
  const { fetchBatch } = pipelineConfig()
  const claims = await claimTexts(fetchBatch * 5)
  if (claims.length === 0) return { itemsProcessed: 0, meta: { texts: 0 } }

  // Справочники читаются один раз на прогон.
  const [reasonRows, categoryRows] = await Promise.all([
    db.select({ id: reasons.id, slug: reasons.slug, categoryId: reasons.categoryId }).from(reasons),
    db.select({ id: reasonCategories.id, code: reasonCategories.code }).from(reasonCategories),
  ])

  const reasonBySlug = new Map(reasonRows.map((r) => [r.slug, r]))
  const unclearCategoryId = categoryRows.find((c) => c.code === 'unclear')?.id ?? null

  let resolved = 0
  let needsReview = 0
  let links = 0
  let unknownSlugs = 0
  let ratioSum = 0

  for (const claim of claims) {
    const analysis = analyzeReasonText(claim.textRaw)
    ratioSum += analysis.coveredCharRatio

    await db.transaction(async (tx) => {
      // Снимаем только автоматические связи прошлой версии правил.
      // Ручные связи неприкосновенны — иначе улучшение правил стирало бы
      // работу человека.
      await tx
        .delete(reasonTextReasons)
        .where(
          and(
            eq(reasonTextReasons.reasonTextId, claim.id),
            inArray(reasonTextReasons.method, ['rule', 'legal_ref', 'similarity']),
            lt(reasonTextReasons.rulesVersion, RULES_VERSION),
          ),
        )

      const matched: { reasonId: string; categoryId: number }[] = []

      for (const match of analysis.matches) {
        const reason = reasonBySlug.get(match.slug)
        if (!reason) {
          // Правило ссылается на slug, которого нет в справочнике:
          // рассинхрон кода и сидов. Молча пропускать нельзя.
          unknownSlugs += 1
          continue
        }

        await tx
          .insert(reasonTextReasons)
          .values({
            reasonTextId: claim.id,
            reasonId: reason.id,
            method: match.method,
            ruleCode: match.ruleCode,
            confidence: '1.000',
            spanStart: match.start,
            spanEnd: match.end,
            rulesVersion: RULES_VERSION,
          })
          .onConflictDoUpdate({
            target: [reasonTextReasons.reasonTextId, reasonTextReasons.reasonId],
            set: {
              method: sql`excluded.method`,
              ruleCode: sql`excluded.rule_code`,
              spanStart: sql`excluded.span_start`,
              spanEnd: sql`excluded.span_end`,
              rulesVersion: sql`excluded.rules_version`,
            },
            // Ручную связь не перезаписываем.
            setWhere: sql`${reasonTextReasons.method} <> 'manual'`,
          })

        matched.push({ reasonId: reason.id, categoryId: reason.categoryId })
      }

      // Остаток есть и ничего не найдено — задача для LLM.
      const review = matched.length === 0 && analysis.remainder.length > 0

      await tx
        .update(reasonTexts)
        .set({
          textNorm: analysis.normalizedText,
          legalRefs: analysis.legalRefs,
          coveredCharRatio: String(analysis.coveredCharRatio),
          rulesVersion: RULES_VERSION,
          reviewState: review ? 'needs_review' : 'auto',
          classifiedAt: new Date(),
        })
        .where(eq(reasonTexts.id, claim.id))

      links += await syncDenialReasons(tx, claim.id, matched)

      if (review) needsReview += 1
      else resolved += 1
    })
  }

  log(
    `текстов ${claims.length}, разобрано правилами ${resolved}, в LLM ${needsReview}, ` +
      `связей ${links}, средняя доля покрытия ${(ratioSum / claims.length).toFixed(3)}`,
  )

  return {
    itemsProcessed: claims.length,
    meta: {
      texts: claims.length,
      resolved,
      needsReview,
      links,
      unknownSlugs,
      coveredCharRatio: Number((ratioSum / claims.length).toFixed(3)),
    },
  }
}

/**
 * Перекладывает связи текста на все отказы с этим текстом.
 *
 * `denial_reasons` — плоская таблица с протащенными `category_id`
 * и `edition_date`: без них дрилл-даун «категория × день» требовал бы
 * join через три таблицы на каждую точку графика.
 *
 * Затронутые дни помечаются в `dirty_days` — витрины пересчитает rollup.
 */
export async function syncDenialReasons(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  reasonTextId: string,
  matched: readonly { reasonId: string; categoryId: number }[],
): Promise<number> {
  const affected = await tx
    .select({ id: denials.id, editionDate: denials.editionDate })
    .from(denials)
    .where(eq(denials.reasonTextId, reasonTextId))

  if (affected.length === 0) return 0

  await tx.delete(denialReasons).where(
    inArray(
      denialReasons.denialId,
      affected.map((d) => d.id),
    ),
  )

  const values = affected.flatMap((denial) =>
    matched.map((match) => ({
      denialId: denial.id,
      reasonId: match.reasonId,
      categoryId: match.categoryId,
      editionDate: denial.editionDate,
    })),
  )

  if (values.length > 0) {
    await tx.insert(denialReasons).values(values).onConflictDoNothing()
  }

  // Дни затронутых отказов — на пересчёт витрин.
  const days = [...new Set(affected.map((d) => d.editionDate))]
  await tx
    .insert(dirtyDays)
    .values(days.map((day) => ({ day, reason: 'canonize' })))
    .onConflictDoUpdate({
      target: dirtyDays.day,
      set: { reason: sql`'canonize'`, markedAt: sql`now()` },
    })

  return values.length
}
