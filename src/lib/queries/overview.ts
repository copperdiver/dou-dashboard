import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import {
  approvals,
  dailyAgeBucketStats,
  dailyReasonCategoryStats,
  dailyStats,
  denialReasons,
  denials,
  ingestDays,
  reasonCategories,
} from '../../db/schema'
import type { AgeBucket } from '../../db/schema'
import { addDays } from '../range'

/**
 * Overview queries. All of them read from the daily marts rather than
 * the raw facts: the mart is the single place where the definition of
 * "new denial" is recorded and where "zero" is distinguished from "no data".
 */

export type DataBounds = { min: string; max: string }

/** Bounds of the loaded period. Needed for the "all time" preset. */
export async function getDataBounds(): Promise<DataBounds | null> {
  const { rows } = await db.execute<{ min: string | null; max: string | null }>(sql`
    select to_char(min(day), 'YYYY-MM-DD') as min,
           to_char(max(day), 'YYYY-MM-DD') as max
      from ${dailyStats}
  `)

  const row = rows[0]
  if (!row?.min || !row?.max) return null
  return { min: row.min, max: row.max }
}

/**
 * Composition of "other decisions". The mart only stores the sum, so the
 * breakdown is pulled from the raw facts: keeping a column per decision
 * kind in `daily_stats` just for one tile's caption isn't worth it.
 */
export type OtherDecisions = {
  /** Case archived. */
  archived: number
  /** Denial upheld on appeal. */
  upheld: number
  /** Reversals, republications, and everything else. */
  other: number
}

export type Kpis30d = {
  approvals: number
  denials: number
  /** Upheld denials and other decisions. Excludes new denials. */
  otherDecisions: number
  breakdown: OtherDecisions
  /** Share of denials among substantive decisions, 0..1. null means no decisions. */
  denialRate: number | null
  prev: {
    approvals: number
    denials: number
    otherDecisions: number
    denialRate: number | null
  }
}

/**
 * KPIs for the last 30 days and the previous 30 for the delta. The
 * window is fixed and independent of the chart period: the tiles answer
 * "what's happening now", while the period picker is a tool for
 * examining the series.
 */
export async function getKpis30d(anchor: string): Promise<Kpis30d> {
  const currentFrom = addDays(anchor, -29)
  const prevTo = addDays(currentFrom, -1)
  const prevFrom = addDays(prevTo, -29)

  const [totals, breakdown] = await Promise.all([
    db.execute<{
      approvals: number
      denials: number
      other_decisions: number
      prev_approvals: number
      prev_denials: number
      prev_other_decisions: number
    }>(sql`
    select
      coalesce(sum(approvals)   filter (where day between ${currentFrom} and ${anchor}), 0)::int as approvals,
      coalesce(sum(denials_new) filter (where day between ${currentFrom} and ${anchor}), 0)::int as denials,
      coalesce(sum(denials_upheld + other_decisions)
                                filter (where day between ${currentFrom} and ${anchor}), 0)::int as other_decisions,
      coalesce(sum(approvals)   filter (where day between ${prevFrom} and ${prevTo}), 0)::int    as prev_approvals,
      coalesce(sum(denials_new) filter (where day between ${prevFrom} and ${prevTo}), 0)::int    as prev_denials,
      coalesce(sum(denials_upheld + other_decisions)
                                filter (where day between ${prevFrom} and ${prevTo}), 0)::int    as prev_other_decisions
      from ${dailyStats}
  `),
    /*
     * The breakdown uses the same conditions as the mart pump, and the
     * groups don't overlap: upheld on appeal, case archived, and
     * everything else. Their sum must match other_decisions from the mart.
     */
    db.execute<{ archived: number; upheld: number; other: number }>(sql`
      select
        count(*) filter (where not counts_as_new_denial and not is_upheld
                           and decision_kind = 'archived')::int              as archived,
        count(*) filter (where is_upheld)::int                               as upheld,
        count(*) filter (where not counts_as_new_denial and not is_upheld
                           and decision_kind <> 'archived')::int             as other
        from ${denials}
       where edition_date between ${currentFrom} and ${anchor}
         and retired_at is null
    `),
  ])

  const row = totals.rows[0]
  const parts = breakdown.rows[0]
  const a = row?.approvals ?? 0
  const d = row?.denials ?? 0
  const pa = row?.prev_approvals ?? 0
  const pd = row?.prev_denials ?? 0

  return {
    approvals: a,
    denials: d,
    otherDecisions: row?.other_decisions ?? 0,
    breakdown: {
      archived: parts?.archived ?? 0,
      upheld: parts?.upheld ?? 0,
      other: parts?.other ?? 0,
    },
    denialRate: a + d > 0 ? d / (a + d) : null,
    prev: {
      approvals: pa,
      denials: pd,
      otherDecisions: row?.prev_other_decisions ?? 0,
      denialRate: pa + pd > 0 ? pd / (pa + pd) : null,
    },
  }
}

/**
 * Why a day has no numbers. This must be distinguished: "no edition"
 * means the absence of an event (there was nothing to publish, so the
 * line legitimately runs through that day), while "not loaded" means an
 * absence of knowledge, and pretending we observed it would be wrong.
 */
export type DayCoverage = 'covered' | 'no_edition' | 'missing'

export type DayPoint = {
  /** `YYYY-MM-DD`. */
  day: string
  /** null means there's no observation for the day; see `coverage` for why. */
  approvals: number | null
  denials: number | null
  /** Upheld denials and other decisions. */
  otherDecisions: number | null
  coverage: DayCoverage
}

/**
 * Daily series.
 *
 * The calendar is generated by the query, and the mart is left-joined
 * in. A missing row in the mart isn't the same as "no data": the mart
 * is only populated for days where something was found. So such days
 * are cross-checked against `ingest_days`:
 *
 *  - `enumerated`: the edition was parsed, no relevant publications were
 *    found. This is an observation, and the value is zero, not a gap.
 *  - `no_edition`: there was no edition. Nothing to publish.
 *  - no record at all: the day was never queued, and we don't know
 *    what was there. This is the only case that's a real gap.
 */
export async function getDailySeries(from: string, to: string): Promise<DayPoint[]> {
  const { rows } = await db.execute<{
    day: string
    approvals: number | null
    denials: number | null
    other_decisions: number | null
    coverage: DayCoverage
  }>(sql`
    with calendar as (
      select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day
    )
    select
      to_char(c.day, 'YYYY-MM-DD') as day,
      case
        when s.coverage = 'covered' then s.approvals
        when s.day is null and i.enumerated then 0
      end as approvals,
      case
        when s.coverage = 'covered' then s.denials_new
        when s.day is null and i.enumerated then 0
      end as denials,
      case
        when s.coverage = 'covered' then s.denials_upheld + s.other_decisions
        when s.day is null and i.enumerated then 0
      end as other_decisions,
      case
        when s.coverage is not null then s.coverage::text
        when i.enumerated  then 'covered'
        when i.no_edition  then 'no_edition'
        else 'missing'
      end as coverage
      from calendar c
      left join ${dailyStats} s on s.day = c.day
      left join lateral (
        select bool_or(status = 'enumerated') as enumerated,
               bool_or(status = 'no_edition') as no_edition
          from ${ingestDays} d where d.edition_date = c.day
      ) i on true
     order by c.day
  `)

  return rows.map((r) => ({
    day: r.day,
    approvals: r.approvals,
    denials: r.denials,
    otherDecisions: r.other_decisions,
    coverage: r.coverage,
  }))
}

export type CategoryBreakdown = {
  rows: CategoryTotal[]
  /** Denials with at least one reason determined. */
  classified: number
  /** Total new denials over the period. */
  total: number
}

export type CategoryTotal = {
  id: number
  code: string
  nameRu: string
  nameEn: string
  /** Palette slot 1..8: the same color as the drilldown line. */
  colorSlot: number
  denials: number
}

/**
 * Totals by reason category over the period.
 *
 * The mart's metric is the number of denials touched by the category. A
 * denial can have several reasons from different categories, so the sum
 * across categories exceeds the number of denials, and the chart's
 * caption must say so.
 *
 * Along with the totals, the number of denials with a determined reason
 * is returned: shares are computed against that, not against all
 * denials. A denial with no reason at all can't land in any numerator,
 * and keeping it in the denominator would understate every share at once.
 */
export async function getReasonCategoryTotals(
  from: string,
  to: string,
): Promise<CategoryBreakdown> {
  const [totals, counts] = await Promise.all([
    db.execute<{
      id: number
      code: string
      name_ru: string
      name_en: string
      color_slot: number
      denials: number
    }>(sql`
      select
        c.id, c.code, c.name_ru, c.name_en, c.color_slot,
        coalesce(sum(s.denials), 0)::int as denials
        from ${reasonCategories} c
        left join ${dailyReasonCategoryStats} s
          on s.category_id = c.id and s.day between ${from} and ${to}
       group by c.id, c.code, c.name_ru, c.name_en, c.color_slot, c.sort_order
       order by denials desc, c.sort_order
    `),
    db.execute<{ total: number; classified: number }>(sql`
      select
        count(*)::int as total,
        count(*) filter (
          where exists (select 1 from ${denialReasons} dr where dr.denial_id = d.id)
        )::int as classified
        from ${denials} d
       where d.retired_at is null
         and d.counts_as_new_denial
         and d.edition_date between ${from} and ${to}
    `),
  ])

  return {
    rows: totals.rows.map((r) => ({
      id: r.id,
      code: r.code,
      nameRu: r.name_ru,
      nameEn: r.name_en,
      colorSlot: r.color_slot,
      denials: r.denials,
    })),
    classified: counts.rows[0]?.classified ?? 0,
    total: counts.rows[0]?.total ?? 0,
  }
}

export type AgeDistribution = {
  buckets: { bucket: AgeBucket; approvals: number }[]
  /** Approvals with no birth date in the source: excluded from the buckets. */
  excluded: number
}

/**
 * Age buckets for the period.
 *
 * The excluded count must be shown: without it the sum of shares
 * doesn't add up to the number of approvals, and the reader draws the
 * wrong conclusion about the sample.
 */
export async function getAgeDistribution(from: string, to: string): Promise<AgeDistribution> {
  const [bucketRows, excludedRows] = await Promise.all([
    db.execute<{ bucket: AgeBucket; approvals: number }>(sql`
      select bucket, sum(approvals)::int as approvals
        from ${dailyAgeBucketStats}
       where day between ${from} and ${to}
       group by bucket
       order by bucket
    `),
    db.execute<{ n: number }>(sql`
      select count(*)::int as n
        from ${approvals}
       where edition_date between ${from} and ${to}
         and retired_at is null
         and counts_as_new_approval
         and age_at_publication is null
    `),
  ])

  return {
    buckets: bucketRows.rows,
    excluded: excludedRows.rows[0]?.n ?? 0,
  }
}
