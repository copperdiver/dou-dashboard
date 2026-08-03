import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { sourcePageHtml, sourcePages } from '../../db/schema'
import { pipelineConfig } from '../../lib/env'
import { sha256Hex } from '../../lib/text'
import type { Pump, PumpContext } from './types'

type Claim = {
  id: string
  url: string
  urlTitle: string
  editionDate: string
  fetchAttempts: number
  /** Hash of the previous body: claiming doesn't change it, so it's still the old value here. */
  oldSha256: string | null
}

/**
 * Claims pages that don't have a body yet. Lease via next_attempt_at:
 * a crashed process doesn't leave a page locked forever.
 */
async function claimPages(limit: number, leaseMs: number): Promise<Claim[]> {
  const result = await db.execute<Claim>(sql`
    with claimed as (
      select id
      from ${sourcePages}
      -- Only pending: for pages that have finally failed, next_attempt_at
      -- is cleared, and including 'failed' would make them forever claimable.
      where fetch_status = 'pending'
        and (next_attempt_at is null or next_attempt_at < now())
      order by edition_date desc, pub_order nulls last
      limit ${limit}
      for update skip locked
    )
    update ${sourcePages} p
       set fetch_attempts = p.fetch_attempts + 1,
           next_attempt_at = now() + make_interval(secs => ${Math.round(leaseMs / 1000)})
      from claimed c
     where p.id = c.id
    returning p.id, p.url, p.url_title as "urlTitle",
              p.edition_date as "editionDate", p.fetch_attempts as "fetchAttempts",
              p.html_sha256 as "oldSha256"
  `)

  return result.rows
}

export const fetchPages: Pump = async ({ log, client }: PumpContext) => {
  const { fetchBatch, maxAttempts, claimLeaseMs } = pipelineConfig()

  const cooldown = await client.cooldownRemainingMs()
  if (cooldown > 0) {
    log(`source cooldown for another ${Math.ceil(cooldown / 1000)}s, skipping`)
    return { itemsProcessed: 0, meta: { skipped: 'cooldown' }, cooldownMs: cooldown }
  }

  const claims = await claimPages(fetchBatch, claimLeaseMs)
  if (claims.length === 0) return { itemsProcessed: 0, meta: { pages: 0 } }

  let fetched = 0
  let gone = 0
  let failures = 0
  let unchanged = 0

  for (const claim of claims) {
    const response = await client.get(claim.url)

    if (response.kind === 'budget_exhausted') {
      log(`daily request budget exhausted (${response.used}/${response.limit})`)
      await releaseClaim(claim, 'daily request budget exhausted', maxAttempts)
      return {
        itemsProcessed: fetched,
        meta: { pages: fetched, budgetExhausted: true },
      }
    }

    if (response.kind === 'forbidden') {
      log(`403 from source, pausing for ${Math.round(response.cooldownMs / 1000)}s`)
      await releaseClaim(claim, `HTTP ${response.status} (WAF)`, maxAttempts)
      return {
        itemsProcessed: fetched,
        meta: { pages: fetched, http403: true },
        cooldownMs: response.cooldownMs,
      }
    }

    if (response.kind === 'gone') {
      await db.execute(sql`
        update ${sourcePages}
           set fetch_status = 'gone', http_status = ${response.status},
               next_attempt_at = null, fetch_error = null, fetched_at = now()
         where id = ${claim.id}
      `)
      gone += 1
      continue
    }

    if (response.kind === 'transient') {
      failures += 1
      await releaseClaim(claim, response.message, maxAttempts)
      log(`${claim.urlTitle}: ${response.message}`)
      continue
    }

    const sha256 = sha256Hex(response.body)

    await db
      .insert(sourcePageHtml)
      .values({ pageId: claim.id, html: response.body, sha256 })
      .onConflictDoUpdate({
        target: sourcePageHtml.pageId,
        set: { html: sql`excluded.html`, sha256: sql`excluded.sha256`, fetchedAt: sql`now()` },
      })

    // Body unchanged: don't reset parser_version, otherwise the page
    // would go back for re-parsing needlessly on every re-fetch.
    const changed = claim.oldSha256 !== sha256

    if (changed) {
      await db.execute(sql`
        update ${sourcePages}
           set fetch_status = 'fetched', http_status = ${response.status},
               fetched_at = now(), next_attempt_at = null, fetch_error = null,
               html_sha256 = ${sha256},
               parser_version = 0,
               parse_status = 'pending'
         where id = ${claim.id}
      `)
    } else {
      unchanged += 1
      await db.execute(sql`
        update ${sourcePages}
           set fetch_status = 'fetched', http_status = ${response.status},
               fetched_at = now(), next_attempt_at = null, fetch_error = null
         where id = ${claim.id}
      `)
    }

    fetched += 1
  }

  log(`pages fetched ${fetched}, gone ${gone}, failures ${failures}`)

  return {
    itemsProcessed: fetched,
    meta: { pages: fetched, gone, failures, unchanged },
  }
}

async function releaseClaim(claim: Claim, message: string, maxAttempts: number): Promise<void> {
  const giveUp = claim.fetchAttempts >= maxAttempts
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, claim.fetchAttempts - 1))

  await db.execute(sql`
    update ${sourcePages}
       set fetch_status = ${giveUp ? 'failed' : 'pending'},
           fetch_error = ${message.slice(0, 1000)},
           next_attempt_at = ${giveUp ? null : sql`now() + make_interval(secs => ${delaySeconds})`}
     where id = ${claim.id}
  `)
}
