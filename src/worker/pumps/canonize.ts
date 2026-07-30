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

/** Сколько отказов чинить за прогон. */
const BACKFILL_BATCH = 500

type Claim = {
  id: string
  textRaw: string
}

/**
 * Достраивает связи отказов с причинами там, где текст уже разобран,
 * а отказ остался без строк в `denial_reasons`.
 *
 * Так получается штатно: текст берётся в работу один раз на версию правил
 * (см. `claimTexts`), и `syncDenialReasons` раскладывает причины только
 * в этот момент. Отказ, разобранный ПОЗЖЕ своей причины, ссылается на уже
 * обработанный текст, повторно тот не претендуется — и связи не появляются
 * никогда. На замере так осталось 850 отказов: причины у них определены,
 * но ни в карточку, ни в категории они не попадали.
 *
 * Проход идемпотентен и дешёв, поэтому выполняется на каждом прогоне: это
 * не разовая починка, а страховка от той же гонки в будущем.
 *
 * Отказы, у текста которых не нашлось ни одной причины, сюда не попадают —
 * их не «чинить» надо, а классифицировать, и это работа насоса enrich.
 * Без этого условия они возвращались бы в выборку каждый прогон и мешали
 * дойти до чинимых.
 */
async function backfillDenialReasons(limit: number): Promise<{ links: number; days: string[] }> {
  const { rows } = await db.execute<{ edition_date: string }>(sql`
    with orphans as (
      select d.id, d.edition_date, d.reason_text_id
        from ${denials} d
       where d.retired_at is null
         and d.reason_text_id is not null
         and not exists (
           select 1 from ${denialReasons} dr where dr.denial_id = d.id
         )
         and exists (
           select 1 from ${reasonTextReasons} rtr
            where rtr.reason_text_id = d.reason_text_id
         )
       limit ${limit}
    ),
    inserted as (
      insert into ${denialReasons} (denial_id, reason_id, category_id, edition_date)
      select o.id, rtr.reason_id, r.category_id, o.edition_date
        from orphans o
        join ${reasonTextReasons} rtr on rtr.reason_text_id = o.reason_text_id
        join ${reasons} r on r.id = rtr.reason_id
      on conflict do nothing
      returning edition_date
    )
    select to_char(edition_date, 'YYYY-MM-DD') as edition_date from inserted
  `)

  return { links: rows.length, days: [...new Set(rows.map((r) => r.edition_date))] }
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

  // Восстанавливающий проход идёт ДО досрочного выхода: когда все тексты
  // разобраны, новых претензий нет, и внутри условия ниже он не запустился
  // бы ни разу — а чинить надо именно в этом состоянии.
  const repaired = await backfillDenialReasons(BACKFILL_BATCH)
  if (repaired.days.length > 0) await markDirty(repaired.days)

  if (claims.length === 0) {
    return {
      itemsProcessed: repaired.links,
      meta: { texts: 0, backfilledLinks: repaired.links, backfilledDays: repaired.days.length },
    }
  }

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
      `связей ${links}, достроено связей ${repaired.links}, ` +
      `средняя доля покрытия ${(ratioSum / claims.length).toFixed(3)}`,
  )

  return {
    itemsProcessed: claims.length,
    meta: {
      texts: claims.length,
      resolved,
      needsReview,
      links,
      backfilledLinks: repaired.links,
      backfilledDays: repaired.days.length,
      unknownSlugs,
      coveredCharRatio: Number((ratioSum / claims.length).toFixed(3)),
    },
  }
}

/** Дни на пересчёт витрин. */
async function markDirty(days: string[]): Promise<void> {
  await db
    .insert(dirtyDays)
    .values(days.map((day) => ({ day, reason: 'canonize-backfill' })))
    .onConflictDoUpdate({
      target: dirtyDays.day,
      set: { reason: sql`'canonize-backfill'`, markedAt: sql`now()` },
    })
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
