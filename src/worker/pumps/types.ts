import type { DouClient } from '../../lib/dou/client'

export type PumpContext = {
  /** Writes a line to the worker log, prefixed with the job name. */
  log: (message: string) => void
  attempt: number
  client: DouClient
}

export type PumpResult = {
  /** How many units of work were processed, goes into job_runs.items_processed. */
  itemsProcessed?: number
  /** Run details: job_runs stores one row per run, not per item. */
  meta?: Record<string, unknown>
  /**
   * A request to pause the queue: the source responded with 403.
   * Handled in the worker via Worker.RateLimitError, so the job goes
   * back to waiting without burning an attempt.
   */
  cooldownMs?: number
}

export type Pump = (ctx: PumpContext) => Promise<PumpResult>
