import { Queue } from 'bullmq'
import { createRedis } from './redis'

/**
 * Queues are split by resource class, not by pipeline step: in BullMQ,
 * concurrency and the limiter are set on the Worker, so different
 * policies (politeness toward in.gov.br vs. CPU-bound parsing vs. LLM
 * limits) each need their own Worker.
 */
export const QUEUE_NAMES = {
  /** Parsing, aggregation, housekeeping jobs. Doesn't touch the network. */
  jobs: 'dou-jobs',
  /** Everything that hits in.gov.br. Exactly one request at a time. */
  fetch: 'dou-fetch',
  /** LLM enrichment: its own limits and its own retry profile. */
  llm: 'dou-llm',
} as const

export type QueueKey = keyof typeof QUEUE_NAMES

const connection = createRedis('queue')

/**
 * attempts: 1 for pumps. Deliberate choice.
 *
 * A pump grabs a batch of work from Postgres, so a "retry" is the next
 * cron tick, not a job restart. With attempts: 3, a poisoned batch would
 * restart three times within half a minute and write three rows to
 * job_runs. Per-item attempt tracking lives in the table itself
 * (`attempts`, `next_attempt_at`), not in Redis.
 */
const PUMP_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
} as const

export const queues: Record<QueueKey, Queue> = {
  jobs: new Queue(QUEUE_NAMES.jobs, { connection, defaultJobOptions: PUMP_JOB_OPTIONS }),
  fetch: new Queue(QUEUE_NAMES.fetch, { connection, defaultJobOptions: PUMP_JOB_OPTIONS }),
  llm: new Queue(QUEUE_NAMES.llm, {
    connection,
    defaultJobOptions: {
      // Failures here really are transient: 429s and provider overload are normal.
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  }),
}

export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()))
  await connection.quit()
}
