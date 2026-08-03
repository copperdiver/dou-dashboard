import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { approvals, denials, dirtyDays } from '../../db/schema'
import type { Pump } from './types'

/**
 * Links denial confirmations to their primary decisions and flags
 * republications.
 *
 * Both values exist so statistics don't count one decision twice:
 *
 *  - `is_upheld` (`Manutenção de Indeferimento`): confirmation of a
 *    prior denial on appeal. `appeal_of_id` points to which one.
 *  - `is_republication`: the same decision for the same process,
 *    already published earlier. Observed: process 235881.0729052/2026
 *    came out as `indeferimento` on July 24, 27, and 29.
 *
 * The recompute is full, not incremental: the link depends on the
 * ENTIRE history (the primary decision could have been published
 * months before the confirmation), and the volume (tens of thousands
 * of rows) is cheaper to compute than it would be to track
 * dependencies. Only days where the value actually changed land in
 * `dirty_days`, otherwise rollup would grind through the whole history on every tick.
 */

/**
 * Linked by process number only. Matching by name is deliberately not
 * done: namesakes have already shown up in a sample of 837 blocks, and
 * a false link between two different people's denials is worse than a missing link.
 */
async function linkAppeals(): Promise<string[]> {
  const result = await db.execute<{ edition_date: string }>(sql`
    update ${denials} d
       set appeal_of_id = p.primary_id,
           appeal_link_method = 'process'
      from (
        select u.id as upheld_id,
               (
                 select pr.id
                   from ${denials} pr
                  where pr.process_number_norm = u.process_number_norm
                    and pr.retired_at is null
                    and not pr.is_upheld
                    and pr.decision_kind = 'denial'
                    and pr.edition_date <= u.edition_date
                    and pr.id <> u.id
                  order by pr.edition_date desc, pr.block_ordinal desc
                  limit 1
               ) as primary_id
          from ${denials} u
         where u.retired_at is null
           and u.is_upheld
           and u.process_number_norm is not null
      ) p
     where d.id = p.upheld_id
       and p.primary_id is not null
       and d.appeal_of_id is distinct from p.primary_id
    returning d.edition_date
  `)

  return result.rows.map((r) => r.edition_date)
}

/**
 * Republication: the same decision for the same process, published earlier.
 *
 * The partition includes `is_upheld`: without it, a denial confirmation
 * would count as a republication of the primary decision, even though
 * they're different decisions sharing the same `decision_kind`.
 */
async function markRepublications(): Promise<string[]> {
  const result = await db.execute<{ edition_date: string }>(sql`
    with ranked as (
      select id,
             row_number() over (
               partition by process_number_norm, decision_kind, is_upheld
               order by edition_date, block_ordinal, id
             ) as seq
        from ${denials}
       where retired_at is null
         and process_number_norm is not null
    )
    update ${denials} d
       set is_republication = (r.seq > 1)
      from ranked r
     where d.id = r.id
       and d.is_republication is distinct from (r.seq > 1)
    returning d.edition_date
  `)

  return result.rows.map((r) => r.edition_date)
}

/**
 * Recomputes the materialized "counts as a new denial" flag.
 *
 * The definition lives here and in the parser as a single expression.
 * Keeping it materialized rather than computing it in every query is a
 * deliberate choice: otherwise the condition would be smeared across
 * every dashboard and feed.
 */
async function recomputeCounts(): Promise<string[]> {
  const result = await db.execute<{ edition_date: string }>(sql`
    update ${denials} d
       set counts_as_new_denial = expected.value
      from (
        select id,
               (
                 decision_kind = 'denial'
                 and not is_upheld
                 and subject_kind = 'naturalization'
                 and not is_republication
               ) as value
          from ${denials}
         where retired_at is null
      ) expected
     where d.id = expected.id
       and d.counts_as_new_denial is distinct from expected.value
    returning d.edition_date
  `)

  return result.rows.map((r) => r.edition_date)
}

/**
 * Republications of approvals.
 *
 * Mirrors `markRepublications` for denials: DOU publishes the same
 * portaria twice under different identifiers and on different edition
 * days. Observed: process 235881.0396673/2023 (BRIGILIEN BRIGIL) came
 * out three times, two of which were the same portaria No. 6,738 from July 2.
 *
 * Matched by process number only, same as denials: linking by name
 * doesn't work because of namesakes, and falsely merging two different
 * people is worse than missing a duplicate.
 *
 * Records with no process number are left untouched: they have no
 * reliable key, and treating them as duplicates on a name match would be a guess.
 */
async function markApprovalRepublications(): Promise<string[]> {
  const result = await db.execute<{ edition_date: string }>(sql`
    with ranked as (
      select id,
             row_number() over (
               partition by process_number_norm
               order by edition_date, ordinal, id
             ) as seq
        from ${approvals}
       where retired_at is null
         and process_number_norm is not null
    )
    update ${approvals} a
       set is_republication = (r.seq > 1)
      from ranked r
     where a.id = r.id
       and a.is_republication is distinct from (r.seq > 1)
    returning to_char(a.edition_date, 'YYYY-MM-DD') as edition_date
  `)

  return result.rows.map((r) => r.edition_date)
}

/** Recomputes the materialized "counts as a new approval" flag. */
async function recomputeApprovalCounts(): Promise<string[]> {
  const result = await db.execute<{ edition_date: string }>(sql`
    update ${approvals} a
       set counts_as_new_approval = not a.is_republication
     where a.retired_at is null
       and a.counts_as_new_approval is distinct from (not a.is_republication)
    returning to_char(a.edition_date, 'YYYY-MM-DD') as edition_date
  `)

  return result.rows.map((r) => r.edition_date)
}

export const linkAppealsAndRepublications: Pump = async ({ log }) => {
  const republications = await markRepublications()
  const appeals = await linkAppeals()
  // Order matters: the "new denial" flag depends on is_republication,
  // so it's recomputed last.
  const counts = await recomputeCounts()

  // Same for approvals: same order, same reason.
  const approvalRepublications = await markApprovalRepublications()
  const approvalCounts = await recomputeApprovalCounts()

  const touchedDays = [
    ...new Set([
      ...republications,
      ...appeals,
      ...counts,
      ...approvalRepublications,
      ...approvalCounts,
    ]),
  ]

  if (touchedDays.length > 0) {
    await db
      .insert(dirtyDays)
      .values(touchedDays.map((day) => ({ day, reason: 'link-appeals' })))
      .onConflictDoUpdate({
        target: dirtyDays.day,
        set: { reason: sql`'link-appeals'`, markedAt: sql`now()` },
      })
  }

  // How many confirmations are still left without a primary decision.
  // This is NOT an error: the primary denial could have been published
  // before the observation window started. Over 20 consecutive days,
  // none of the 31 confirmations had a primary decision within the window.
  const [orphans] = await db
    .execute<{ orphans: number; upheld: number }>(sql`
      select
        count(*) filter (where appeal_of_id is null)::int as orphans,
        count(*)::int                                     as upheld
        from ${denials}
       where retired_at is null and is_upheld
    `)
    .then((r) => r.rows)

  log(
    `republications changed ${republications.length}, ` +
      `appeals linked ${appeals.length}, flags recomputed ${counts.length}, ` +
      `approval republications ${approvalRepublications.length}, ` +
      `approval flags ${approvalCounts.length}, ` +
      `confirmations without a primary decision ${orphans?.orphans ?? 0} of ${orphans?.upheld ?? 0}`,
  )

  return {
    itemsProcessed: touchedDays.length,
    meta: {
      republications: republications.length,
      appealsLinked: appeals.length,
      countsRecomputed: counts.length,
      approvalRepublications: approvalRepublications.length,
      approvalCountsRecomputed: approvalCounts.length,
      daysMarked: touchedDays.length,
      upheldTotal: orphans?.upheld ?? 0,
      upheldWithoutPrimary: orphans?.orphans ?? 0,
    },
  }
}
