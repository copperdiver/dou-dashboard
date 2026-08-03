import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { ingestDaySnapshots, ingestDays, sourcePages } from '../../db/schema'
import { articleUrl, dailyIndexUrl } from '../../lib/dou/client'
import { parseDailyIndex, parsePubDate, selectRelevant } from '../../lib/dou/daily-index'
import { pipelineConfig } from '../../lib/env'
import { sha256Hex } from '../../lib/text'
import type { Pump, PumpContext } from './types'

type Claim = {
  editionDate: string
  section: string
  attempts: number
}

/**
 * Claims a batch of days to work on.
 *
 * `for update skip locked` plus a lease via next_attempt_at: if the
 * process crashes, the row doesn't stay stuck in running forever: once
 * the lease expires it can be claimed again. This is what makes the
 * 250-day backfill's progress recoverable without involving Redis.
 */
async function claimDays(limit: number, leaseMs: number): Promise<Claim[]> {
  const result = await db.execute<Claim>(sql`
    with claimed as (
      select edition_date, section
      from ${ingestDays}
      -- pending with expired backoff, or running with an expired lease.
      -- We don't take failed: that's a terminal state until a manual
      -- reset, otherwise a day that has finally failed would retry forever.
      where status in ('pending', 'running')
        and (next_attempt_at is null or next_attempt_at < now())
      order by priority, edition_date desc
      limit ${limit}
      for update skip locked
    )
    update ${ingestDays} d
       set status = 'running',
           attempts = d.attempts + 1,
           started_at = now(),
           next_attempt_at = now() + make_interval(secs => ${Math.round(leaseMs / 1000)})
      from claimed c
     where d.edition_date = c.edition_date
       and d.section = c.section
    returning d.edition_date as "editionDate", d.section, d.attempts
  `)

  return result.rows
}

async function markFailure(
  claim: Claim,
  message: string,
  maxAttempts: number,
): Promise<'retry' | 'failed'> {
  const giveUp = claim.attempts >= maxAttempts
  // Exponential backoff by attempt number, capped at an hour.
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, claim.attempts - 1))

  await db.execute(sql`
    update ${ingestDays}
       set status = ${giveUp ? 'failed' : 'pending'},
           last_error = ${message.slice(0, 1000)},
           next_attempt_at = ${giveUp ? null : sql`now() + make_interval(secs => ${delaySeconds})`}
     where edition_date = ${claim.editionDate}
       and section = ${claim.section}
  `)

  return giveUp ? 'failed' : 'retry'
}

/**
 * Whether the edition day has already ended by the Brazilian calendar.
 *
 * Compared against São Paulo specifically, not server time: the edition
 * lives on its own calendar, and our timezone is irrelevant to it. With
 * TZ=Europe/Moscow, the server's "today" starts six hours before Brazil's.
 * That mismatch is exactly how days used to get lost.
 */
export function isEditionDayOver(editionDate: string, now: Date = new Date()): boolean {
  // en-CA gives exactly YYYY-MM-DD, so the strings are directly comparable.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now)
  return today > editionDate
}

/**
 * Empty index: no edition, or not yet.
 *
 * A single response can't tell these apart, and the cost of getting it
 * wrong is asymmetric. Polling a fresh day happens at night Brazil time:
 * DOU publishes the edition in the morning, and until then the index is
 * legitimately empty. Closing the day on that basis loses it forever:
 * the status is terminal, and `discover` inserts days via
 * `on conflict do nothing`, so it never reopens a closed day. That's
 * exactly how fresh editions used to go missing.
 *
 * So "there was no edition" is only a valid conclusion for a day that
 * has already passed by the Brazilian calendar. While the day is still
 * ongoing, an empty index just means "too early," and we come back in a
 * few hours. On weekends this costs a handful of extra requests a day
 * (nothing against the daily budget) while a missed edition can't be
 * recovered.
 */
async function markEmptyIndex(claim: Claim, retryAfterHours: number): Promise<'no_edition' | 'retry'> {
  const dayIsOver = isEditionDayOver(claim.editionDate)

  await db.execute(sql`
    update ${ingestDays}
       set status = ${dayIsOver ? 'no_edition' : 'pending'},
           articles_found = 0,
           relevant_found = 0,
           last_error = null,
           completed_at = ${dayIsOver ? sql`now()` : null},
           next_attempt_at = ${
             dayIsOver ? null : sql`now() + make_interval(hours => ${retryAfterHours})`
           }
     where edition_date = ${claim.editionDate} and section = ${claim.section}
  `)

  return dayIsOver ? 'no_edition' : 'retry'
}

/**
 * Fetches the daily index, saves a snapshot, and upserts relevant articles.
 *
 * The raw jsonArray snapshot is always stored: it lets us later widen
 * the relevance filter and re-parse history without hitting the network.
 */
export const enumerate: Pump = async ({ log, client }: PumpContext) => {
  const { enumerateBatch, maxAttempts, claimLeaseMs, emptyIndexRetryHours } = pipelineConfig()

  const cooldown = await client.cooldownRemainingMs()
  if (cooldown > 0) {
    log(`source cooldown for another ${Math.ceil(cooldown / 1000)}s, skipping`)
    return { itemsProcessed: 0, meta: { skipped: 'cooldown' }, cooldownMs: cooldown }
  }

  const claims = await claimDays(enumerateBatch, claimLeaseMs)
  if (claims.length === 0) return { itemsProcessed: 0, meta: { days: 0 } }

  let daysDone = 0
  let pagesUpserted = 0
  let noEdition = 0
  let failures = 0
  let schemaMismatch = 0

  for (const claim of claims) {
    const url = dailyIndexUrl(claim.editionDate, claim.section)
    const response = await client.get(url)

    if (response.kind === 'budget_exhausted') {
      log(`daily request budget exhausted (${response.used}/${response.limit})`)
      await markFailure(claim, 'daily request budget exhausted', maxAttempts)
      return {
        itemsProcessed: daysDone,
        meta: { days: daysDone, pages: pagesUpserted, budgetExhausted: true },
      }
    }

    if (response.kind === 'forbidden') {
      log(`403 from source, pausing for ${Math.round(response.cooldownMs / 1000)}s`)
      await markFailure(claim, `HTTP ${response.status} (WAF)`, maxAttempts)
      return {
        itemsProcessed: daysDone,
        meta: { days: daysDone, pages: pagesUpserted, http403: true },
        cooldownMs: response.cooldownMs,
      }
    }

    if (response.kind === 'gone') {
      // No edition exists for this day. That's not a failure. But if the
      // day isn't over yet, it may simply not exist yet.
      const outcome = await markEmptyIndex(claim, emptyIndexRetryHours)
      if (outcome === 'no_edition') noEdition += 1
      else log(`${claim.editionDate}: no edition yet (HTTP ${response.status}) → will check later`)
      continue
    }

    if (response.kind === 'transient') {
      failures += 1
      const outcome = await markFailure(claim, response.message, maxAttempts)
      log(`${claim.editionDate}: ${response.message} → ${outcome}`)
      continue
    }

    const index = parseDailyIndex(response.body)

    if (index === null) {
      // 200, but no <script id="params">: markup changed. This is the
      // main signal that "the source broke," and it must not be muted with retries.
      schemaMismatch += 1
      await db.execute(sql`
        update ${ingestDays}
           set status = 'failed',
               last_error = 'markup changed: no script#params',
               next_attempt_at = null
         where edition_date = ${claim.editionDate} and section = ${claim.section}
      `)
      log(`${claim.editionDate}: MARKUP CHANGED (no script#params)`)
      continue
    }

    if (index.items.length === 0) {
      const outcome = await markEmptyIndex(claim, emptyIndexRetryHours)
      if (outcome === 'no_edition') noEdition += 1
      else log(`${claim.editionDate}: index is empty, day still ongoing → will check later`)
      continue
    }

    const relevant = selectRelevant(index.items)

    await db
      .insert(ingestDaySnapshots)
      .values({
        editionDate: claim.editionDate,
        section: claim.section,
        jsonRaw: JSON.stringify(index.items),
        sha256: sha256Hex(JSON.stringify(index.items)),
      })
      .onConflictDoUpdate({
        target: [ingestDaySnapshots.editionDate, ingestDaySnapshots.section],
        set: {
          jsonRaw: sql`excluded.json_raw`,
          sha256: sql`excluded.sha256`,
          fetchedAt: sql`now()`,
        },
      })

    if (relevant.length > 0) {
      const inserted = await db
        .insert(sourcePages)
        .values(
          relevant.map((item) => ({
            urlTitle: item.urlTitle,
            url: articleUrl(item.urlTitle),
            // The edition date comes from the article's pubDate, not from
            // the polled day: they diverge (an act from July 28 gets printed on the 29th).
            editionDate: parsePubDate(item.pubDate) ?? claim.editionDate,
            section: claim.section,
            editionNumber: item.editionNumber,
            pageNumber: item.numberPage,
            artType: item.artType,
            pubOrder: item.pubOrder,
            hierarchyStr: item.hierarchyStr,
            title: item.title,
            selectedBy: item.selectedBy,
          })),
        )
        // Don't reset an already-fetched page back to pending: only its
        // metadata from the index gets updated.
        .onConflictDoUpdate({
          target: sourcePages.urlTitle,
          set: {
            title: sql`excluded.title`,
            hierarchyStr: sql`excluded.hierarchy_str`,
            selectedBy: sql`excluded.selected_by`,
            editionNumber: sql`excluded.edition_number`,
            pageNumber: sql`excluded.page_number`,
            pubOrder: sql`excluded.pub_order`,
          },
        })
        .returning({ id: sourcePages.id })

      pagesUpserted += inserted.length
    }

    await db.execute(sql`
      update ${ingestDays}
         set status = 'enumerated',
             articles_found = ${index.items.length},
             relevant_found = ${relevant.length},
             next_attempt_at = null,
             completed_at = now(),
             last_error = null
       where edition_date = ${claim.editionDate} and section = ${claim.section}
    `)

    daysDone += 1
    log(`${claim.editionDate}: articles ${index.items.length}, relevant ${relevant.length}`)
  }

  return {
    // Days without an edition are processed work too: otherwise the run
    // metric would show zero for a batch consisting only of weekend days.
    itemsProcessed: daysDone + noEdition,
    meta: {
      days: daysDone,
      pages: pagesUpserted,
      noEdition,
      failures,
      schemaMismatch,
    },
  }
}
