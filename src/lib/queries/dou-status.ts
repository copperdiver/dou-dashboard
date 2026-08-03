import IORedis from 'ioredis'
import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { ingestDays, jobRuns, sourcePages } from '../../db/schema'
import { isProxyConfigured } from '../dou/client'
import { douConfig } from '../env'

/**
 * State of the connection to in.gov.br.
 *
 * Assembled from what the pipeline already knows: the cooldown after a
 * 403 and the daily request spend live in Redis, the history of
 * attempts lives in `ingest_days` and `job_runs`. There's deliberately
 * no request to the source here.
 *
 * Pinging DOU on every page view is off the table for three reasons: it
 * would count against the daily budget, it would push request
 * frequency past `DOU_MIN_INTERVAL_MS`, and it could wake up the very
 * WAF that the cooldowns and refusal streaks exist to appease. On top
 * of that, real pump traffic says more about availability than a
 * synthetic check would: it hits real URLs at a real cadence.
 *
 * The on-demand one-off check lives separately. See `probeDou`.
 */

const COOLDOWN_KEY = 'dou:cooldown:until'
const STREAK_KEY = 'dou:forbidden:streak'
const BUDGET_PREFIX = 'dou:budget:'
const PROBE_KEY = 'dou:probe:last'

export type DouProbe = {
  at: string
  ok: boolean
  /** HTTP status code, or null if the response never came back. */
  status: number | null
  message: string
  durationMs: number
}

export type DouStatus = {
  /** Ms until the end of the post-403 cooldown. 0 means no cooldown. */
  cooldownMs: number
  /** How many 403s in a row have been received. */
  forbiddenStreak: number
  budget: { used: number; limit: number }
  /** Last SUCCESSFUL parse of a daily index. */
  lastSuccessAt: string | null
  /** Last failure with the reason, as recorded by the client. */
  lastFailure: { day: string; error: string; attempts: number } | null
  /** Days that finally failed and are waiting for a manual reset. */
  failedDays: number
  /** Pages waiting to be fetched. */
  pendingPages: number
  /** Last check triggered by the button. */
  probe: DouProbe | null
  redisAvailable: boolean
  /** Whether traffic to the source is going through a proxy. */
  viaProxy: boolean
}

/**
 * Its own Redis connection rather than sharing one with the queues:
 * those live in the worker, while this is read by the web app. The
 * connection is lazy and reused across requests: opening it on every
 * page view would be expensive.
 */
let redis: IORedis | null = null

/**
 * Returns a CONNECTED connection or null.
 *
 * Connecting is part of getting the connection, not the caller's
 * concern: the connection is lazy and has the offline queue disabled,
 * so a command on a socket that isn't up yet fails immediately. We've
 * been bitten by this once already.
 */
export async function getRedis(): Promise<IORedis | null> {
  if (!process.env.REDIS_URL) return null
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      // The status page shouldn't wait on an unavailable Redis: without
      // it, it just shows the remaining metrics.
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    })
    redis.on('error', () => {})
  }

  if (redis.status === 'wait' || redis.status === 'end') {
    try {
      await redis.connect()
    } catch {
      return null
    }
  }

  return redis
}

export async function getDouStatus(): Promise<DouStatus> {
  const cfg = douConfig()
  const today = new Date().toISOString().slice(0, 10)

  const [fromRedis, lastSuccess, lastFailure, counts] = await Promise.all([
    readRedis(today),
    db.execute<{ at: string | null }>(sql`
      select to_char(max(completed_at), 'YYYY-MM-DD"T"HH24:MI:SSOF') as at
        from ${ingestDays} where status = 'enumerated'
    `),
    db.execute<{ day: string; err: string; attempts: number }>(sql`
      select to_char(edition_date, 'YYYY-MM-DD') as day,
             coalesce(last_error, '') as err, attempts
        from ${ingestDays}
       where last_error is not null
       order by started_at desc nulls last
       limit 1
    `),
    db.execute<{ failed_days: number; pending_pages: number }>(sql`
      select
        (select count(*)::int from ${ingestDays} where status = 'failed')        as failed_days,
        (select count(*)::int from ${sourcePages}
          where fetch_status in ('pending', 'failed'))                           as pending_pages
    `),
  ])

  const failure = lastFailure.rows[0]

  return {
    ...fromRedis,
    budget: { used: fromRedis.budget.used, limit: cfg.maxRequestsPerDay },
    lastSuccessAt: lastSuccess.rows[0]?.at ?? null,
    lastFailure: failure ? { day: failure.day, error: failure.err, attempts: failure.attempts } : null,
    failedDays: counts.rows[0]?.failed_days ?? 0,
    pendingPages: counts.rows[0]?.pending_pages ?? 0,
    viaProxy: isProxyConfigured(),
  }
}

async function readRedis(today: string): Promise<{
  cooldownMs: number
  forbiddenStreak: number
  budget: { used: number; limit: number }
  probe: DouProbe | null
  redisAvailable: boolean
}> {
  const empty = {
    cooldownMs: 0,
    forbiddenStreak: 0,
    budget: { used: 0, limit: 0 },
    probe: null,
    redisAvailable: false,
  }

  const client = await getRedis()
  if (!client) return empty

  try {
    const [cooldown, streak, used, probe] = await client.mget(
      COOLDOWN_KEY,
      STREAK_KEY,
      `${BUDGET_PREFIX}${today}`,
      PROBE_KEY,
    )

    const until = Number.parseInt(cooldown ?? '', 10)

    return {
      cooldownMs: Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0,
      forbiddenStreak: Number.parseInt(streak ?? '0', 10) || 0,
      budget: { used: Number.parseInt(used ?? '0', 10) || 0, limit: 0 },
      probe: probe ? (JSON.parse(probe) as DouProbe) : null,
      redisAvailable: true,
    }
  } catch {
    // Redis being unavailable is itself a signal, but the rest of the
    // data from the database still needs to be returned.
    return empty
  }
}

/** Saves the result of a one-off check so the page can show it. */
export async function saveProbe(probe: DouProbe): Promise<void> {
  const client = await getRedis()
  if (!client) return
  try {
    // One-hour TTL: an older check says nothing about "now".
    await client.set(PROBE_KEY, JSON.stringify(probe), 'EX', 3600)
  } catch {
    // Failed to write: the check has already been run and shown regardless.
  }
}

/** When we last successfully fetched an article page. */
export async function getLastFetchRun(): Promise<string | null> {
  const { rows } = await db.execute<{ at: string | null }>(sql`
    select to_char(max(started_at), 'YYYY-MM-DD"T"HH24:MI:SSOF') as at
      from ${jobRuns}
     where job_name = 'fetch' and status = 'success'
  `)
  return rows[0]?.at ?? null
}
