/**
 * Registry of pumps and their schedule.
 *
 * Each job is an idempotent pump: it grabs a batch of work from Postgres,
 * processes it, and finishes. Progress lives in tables (`ingest_days`,
 * `source_pages`), not in Redis, so restarting the worker or flushing
 * the queues doesn't break the 250-day backfill.
 *
 * To add a pump: describe it in SCHEDULE and add a handler in handlers
 * under the same name. The schedule is synced on startup.
 */
import { canonizeReasons } from './pumps/canonize'
import { discover } from './pumps/discover'
import { enrichReasons } from './pumps/enrich'
import { enumerate } from './pumps/enumerate'
import { fetchPages } from './pumps/fetch'
import { linkAppealsAndRepublications } from './pumps/link-appeals'
import { parsePages } from './pumps/parse'
import { rollupDays } from './pumps/rollup'
import type { Pump } from './pumps/types'
import type { QueueKey } from './queue'

export type ScheduledJob = {
  name: string
  /** Which queue it runs in: this determines its limits and concurrency. */
  queue: QueueKey
  /** Cron expression in the process's timezone (see TZ in .env). */
  pattern: string
  description: string
}

export const SCHEDULE: readonly ScheduledJob[] = [
  {
    name: 'heartbeat',
    queue: 'jobs',
    pattern: '*/5 * * * *',
    description: 'Heartbeat: checks that the worker and DB are alive',
  },
  {
    name: 'discover',
    queue: 'jobs',
    pattern: '0 6,14 * * *',
    description: 'Queues days from the past week',
  },
  {
    name: 'enumerate',
    queue: 'fetch',
    pattern: '*/10 * * * *',
    description: 'DOU daily index → snapshot and article list',
  },
  {
    name: 'fetch',
    queue: 'fetch',
    pattern: '*/5 * * * *',
    description: 'Downloads article pages',
  },
  {
    name: 'parse',
    queue: 'jobs',
    pattern: '*/5 * * * *',
    description: 'Parses pages: acts, people, decisions',
  },
  {
    name: 'canonize',
    queue: 'jobs',
    pattern: '*/5 * * * *',
    description: 'Rule-based canonization of denial reasons',
  },
  {
    name: 'enrich',
    queue: 'llm',
    pattern: '*/10 * * * *',
    description: 'LLM enrichment of the remaining reasons',
  },
  {
    name: 'link-appeals',
    queue: 'jobs',
    // At night: this is a full recompute over the whole history, and the
    // link only changes when new decisions show up, i.e. every few days.
    pattern: '23 2 * * *',
    description: 'Links denial confirmations to primary decisions and marks republications',
  },
  {
    name: 'rollup',
    queue: 'jobs',
    pattern: '*/5 * * * *',
    description: 'Recomputes daily dashboards for affected days',
  },
] as const

export const handlers: Record<string, Pump> = {
  async heartbeat({ log }) {
    log('heartbeat')
    return { itemsProcessed: 1 }
  },
  discover,
  enumerate,
  fetch: fetchPages,
  parse: parsePages,
  canonize: canonizeReasons,
  enrich: enrichReasons,
  'link-appeals': linkAppealsAndRepublications,
  rollup: rollupDays,
}
