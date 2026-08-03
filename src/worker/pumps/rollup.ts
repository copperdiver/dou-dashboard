import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import {
  approvals,
  dailyAgeBucketStats,
  dailyCountryStats,
  dailyReasonCategoryStats,
  dailyStateStats,
  dailyStats,
  denialReasons,
  denials,
  dirtyDays,
  ingestDays,
  sourcePages,
} from '../../db/schema'
import type { Pump } from './types'

/**
 * Recomputes daily dashboards for the days listed in `dirty_days`.
 *
 * These dashboards aren't here for speed: with 14k approvals, any chart
 * computes in single-digit milliseconds off the indexes. They exist for
 * three other reasons:
 *
 *  1. A single definition of "a new denial": in one place, not smeared
 *     across seven queries.
 *  2. Distinguishing "no data" from "zero." A day with no edition and a
 *     day that failed to fetch are not "zero approvals," and `coverage`
 *     comes from `ingest_days`, not from the facts.
 *  3. A "category × day" drill-down without a three-table join for every
 *     point on the chart.
 *
 * Recomputing a day is a delete-then-insert in one transaction:
 * idempotent and re-runnable. A full rebuild just means seeding
 * `dirty_days` with the desired range.
 */

const BATCH = 30

type Claim = { day: string }

async function claimDays(limit: number): Promise<Claim[]> {
  // Claim by deleting: the marker row IS the unit of work, so no separate
  // lease is needed. A crashed run just loses the marker, and the next
  // parse/canonize will put it back.
  const result = await db.execute<Claim>(sql`
    with candidates as (
      select day from ${dirtyDays}
      order by day desc
      limit ${limit}
      for update skip locked
    )
    delete from ${dirtyDays} d
     using candidates c
     where d.day = c.day
    returning d.day
  `)

  return result.rows
}

/**
 * Age buckets are fixed in code: the boundaries must match the chart
 * labels, and changing them should be a deliberate event, not a side
 * effect of an SQL edit.
 */
const AGE_BUCKET_SQL = sql`
  case
    when age_at_publication < 18 then '0-17'
    when age_at_publication < 25 then '18-24'
    when age_at_publication < 35 then '25-34'
    when age_at_publication < 45 then '35-44'
    when age_at_publication < 55 then '45-54'
    when age_at_publication < 65 then '55-64'
    else '65+'
  end
`

export const rollupDays: Pump = async ({ log }) => {
  const claims = await claimDays(BATCH)
  if (claims.length === 0) return { itemsProcessed: 0, meta: { days: 0 } }

  let approvalsTotal = 0
  let denialsTotal = 0
  let missing = 0

  for (const { day } of claims) {
    await db.transaction(async (tx) => {
      /*
       * coverage comes from ingest_days, not from the facts: otherwise
       * it's impossible to tell "nobody was naturalized that day" apart
       * from "we didn't fetch that day." The frontend draws a line gap
       * for `missing`/`no_edition`, not a zero point.
       */
      const [coverageRow] = await tx.execute<{ coverage: string }>(sql`
        select case
                 when count(*) = 0 then 'missing'
                 when count(*) filter (where status = 'enumerated') > 0 then 'covered'
                 when count(*) filter (where status = 'no_edition') > 0 then 'no_edition'
                 else 'missing'
               end as coverage
          from ${ingestDays}
         where edition_date = ${day}
      `).then((r) => r.rows)

      const coverage = coverageRow?.coverage ?? 'missing'
      if (coverage !== 'covered') missing += 1

      const [totals] = await tx.execute<{
        approvals: number
        denials_new: number
        denials_upheld: number
        other_decisions: number
        pages: number
        acts: number
      }>(sql`
        select
          -- The definition of "a new approval" lives in counts_as_new_approval:
          -- a republication of the same portaria doesn't count, otherwise
          -- one person would be counted twice.
          (select count(*)::int from ${approvals}
            where edition_date = ${day} and retired_at is null
              and counts_as_new_approval)                                            as approvals,
          -- The definition of "a new denial" lives in counts_as_new_denial:
          -- an appeal confirmation and a republication don't count,
          -- otherwise the stats would double.
          (select count(*)::int from ${denials}
            where edition_date = ${day} and retired_at is null
              and counts_as_new_denial)                                              as denials_new,
          (select count(*)::int from ${denials}
            where edition_date = ${day} and retired_at is null and is_upheld)        as denials_upheld,
          (select count(*)::int from ${denials}
            where edition_date = ${day} and retired_at is null
              and not counts_as_new_denial and not is_upheld)                        as other_decisions,
          (select count(*)::int from ${sourcePages} where edition_date = ${day})     as pages,
          (select count(*)::int from ${sourcePages} p
             join acts a on a.page_id = p.id where a.edition_date = ${day})          as acts
      `).then((r) => r.rows)

      await tx
        .insert(dailyStats)
        .values({
          day,
          approvals: totals?.approvals ?? 0,
          denialsNew: totals?.denials_new ?? 0,
          denialsUpheld: totals?.denials_upheld ?? 0,
          otherDecisions: totals?.other_decisions ?? 0,
          pages: totals?.pages ?? 0,
          acts: totals?.acts ?? 0,
          coverage: coverage as 'covered' | 'missing' | 'no_edition',
        })
        .onConflictDoUpdate({
          target: dailyStats.day,
          set: {
            approvals: sql`excluded.approvals`,
            denialsNew: sql`excluded.denials_new`,
            denialsUpheld: sql`excluded.denials_upheld`,
            otherDecisions: sql`excluded.other_decisions`,
            pages: sql`excluded.pages`,
            acts: sql`excluded.acts`,
            coverage: sql`excluded.coverage`,
            computedAt: sql`now()`,
          },
        })

      approvalsTotal += totals?.approvals ?? 0
      denialsTotal += totals?.denials_new ?? 0

      // Breakdowns: delete and re-insert (idempotent), and doesn't leave
      // rows for dimensions that disappeared for the day.
      await tx.delete(dailyCountryStats).where(sql`${dailyCountryStats.day} = ${day}`)
      await tx.execute(sql`
        insert into ${dailyCountryStats} (day, country_id, approvals)
        select ${day}::date, country_id, count(*)::int
          from ${approvals}
         where edition_date = ${day} and retired_at is null and counts_as_new_approval
           and country_id is not null
         group by country_id
      `)

      await tx.delete(dailyStateStats).where(sql`${dailyStateStats.day} = ${day}`)
      await tx.execute(sql`
        insert into ${dailyStateStats} (day, state_id, approvals)
        select ${day}::date, state_id, count(*)::int
          from ${approvals}
         where edition_date = ${day} and retired_at is null and counts_as_new_approval
           and state_id is not null
         group by state_id
      `)

      await tx.delete(dailyAgeBucketStats).where(sql`${dailyAgeBucketStats.day} = ${day}`)
      await tx.execute(sql`
        insert into ${dailyAgeBucketStats} (day, bucket, approvals)
        select ${day}::date, (${AGE_BUCKET_SQL})::age_bucket, count(*)::int
          from ${approvals}
         where edition_date = ${day} and retired_at is null and counts_as_new_approval
           and age_at_publication is not null
         group by 2
      `)

      /*
       * The category metric is count(distinct denial_id), NOT the number
       * of links: a denial can have several reasons from different
       * categories, so the sum across columns doesn't equal the number
       * of denials. The chart label must say so explicitly: "denials touched by category."
       */
      await tx.delete(dailyReasonCategoryStats).where(sql`${dailyReasonCategoryStats.day} = ${day}`)
      await tx.execute(sql`
        insert into ${dailyReasonCategoryStats} (day, category_id, denials)
        select ${day}::date, dr.category_id, count(distinct dr.denial_id)::int
          from ${denialReasons} dr
          join ${denials} d on d.id = dr.denial_id
         where dr.edition_date = ${day}
           and d.retired_at is null
           and d.counts_as_new_denial
         group by dr.category_id
      `)
    })
  }

  log(
    `days ${claims.length}, approvals ${approvalsTotal}, new denials ${denialsTotal}, ` +
      `days without coverage ${missing}`,
  )

  return {
    itemsProcessed: claims.length,
    meta: { days: claims.length, approvals: approvalsTotal, denialsNew: denialsTotal, missing },
  }
}
