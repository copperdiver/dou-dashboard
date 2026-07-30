import { Queue } from 'bullmq'
import { createRedis } from './redis'

/**
 * Очереди разделены по классу ресурса, а не по шагу конвейера: в BullMQ
 * concurrency и limiter задаются на Worker, поэтому разные политики
 * (вежливость к in.gov.br против CPU-разбора против лимитов LLM)
 * требуют разных Worker.
 */
export const QUEUE_NAMES = {
  /** Разбор, агрегация, служебные задачи. Сети не касается. */
  jobs: 'dou-jobs',
  /** Всё, что стучится в in.gov.br. Ровно один запрос за раз. */
  fetch: 'dou-fetch',
  /** Обогащение через LLM: свои лимиты и свой профиль ретраев. */
  llm: 'dou-llm',
} as const

export type QueueKey = keyof typeof QUEUE_NAMES

const connection = createRedis('queue')

/**
 * attempts: 1 для насосов — сознательно.
 *
 * Насос забирает пачку работы из Postgres, поэтому «повтор» — это
 * следующий тик крона, а не перезапуск задания. С attempts: 3 отравленная
 * пачка трижды перезапустилась бы за полминуты и трижды записала строку
 * в job_runs. Учёт попыток по единице работы живёт в самой таблице
 * (`attempts`, `next_attempt_at`), а не в Redis.
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
      // Здесь сбой действительно транзиентен: 429 и перегрузка провайдера — норма.
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
