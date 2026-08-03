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
 * Canonization of reason texts through deterministic means.
 *
 * Operates on UNIQUE texts (`reason_texts`), not on denials: measured
 * at 203 unique texts for 267 denials, and rules plus the LLM should
 * see each text exactly once.
 *
 * Rules and the legal-reference decoder cover 94% of texts. The rest
 * is flagged `needs_review` and picked up by the enrich pump.
 *
 * Manual edits aren't overwritten: texts in `confirmed`/`corrected`
 * state aren't touched by automation, and links with `method='manual'`
 * survive a rewrite.
 */

/** How many denials to repair per run. */
const BACKFILL_BATCH = 500

type Claim = {
  id: string
  textRaw: string
}

/**
 * Fills in denial-to-reason links where the text is already parsed but
 * the denial is still missing rows in `denial_reasons`.
 *
 * This happens by design: a text is claimed for processing once per
 * rules version (see `claimTexts`), and `syncDenialReasons` only lays
 * down reasons at that moment. A denial parsed AFTER its reason text
 * references an already-processed text, which never gets claimed
 * again. So the links never appear. Measured at 850 denials left this
 * way: their reasons were determined, but they never made it into the
 * card or the categories.
 *
 * This pass is idempotent and cheap, so it runs on every run: it's not
 * a one-off fix, it's insurance against the same race happening again.
 *
 * Denials whose text matched no reason at all don't land here: they
 * don't need "repairing," they need classifying, and that's the enrich
 * pump's job. Without this condition they'd come back into the query
 * every run and get in the way of reaching the ones that actually need repair.
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

  // The repair pass runs BEFORE the early return: once all texts are
  // parsed, there are no new claims, and inside the condition below it
  // would never run. But that's exactly the state where repairs are needed.
  const repaired = await backfillDenialReasons(BACKFILL_BATCH)
  if (repaired.days.length > 0) await markDirty(repaired.days)

  if (claims.length === 0) {
    return {
      itemsProcessed: repaired.links,
      meta: { texts: 0, backfilledLinks: repaired.links, backfilledDays: repaired.days.length },
    }
  }

  // Lookup tables are read once per run.
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
      // Only automatic links from the previous rules version are removed.
      // Manual links are untouchable: otherwise improving the rules
      // would erase a human's work.
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
          // A rule references a slug that isn't in the lookup table:
          // code and seed data are out of sync. Can't silently skip this.
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
            // Don't overwrite a manual link.
            setWhere: sql`${reasonTextReasons.method} <> 'manual'`,
          })

        matched.push({ reasonId: reason.id, categoryId: reason.categoryId })
      }

      // There's a remainder and nothing matched: a job for the LLM.
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
    `texts ${claims.length}, resolved by rules ${resolved}, sent to LLM ${needsReview}, ` +
      `links ${links}, backfilled links ${repaired.links}, ` +
      `average coverage ratio ${(ratioSum / claims.length).toFixed(3)}`,
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

/** Days to recompute dashboards for. */
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
 * Propagates a text's links to every denial that has that text.
 *
 * `denial_reasons` is a flat table with `category_id` and `edition_date`
 * carried along: without them, a "category × day" drill-down would need
 * a three-table join for every point on the chart.
 *
 * Affected days are flagged in `dirty_days`. Rollup will recompute the dashboards.
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

  // Days of affected denials go on the dashboard recompute list.
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
