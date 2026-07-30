/**
 * Процесс фоновых задач: отдельный контейнер worker в docker compose.
 *
 * Три Worker в одном процессе — по классу ресурса, а не по шагу конвейера.
 * Отвечает за две вещи: регистрирует расписание в Redis и исполняет
 * насосы, записывая один прогон в job_runs (не один элемент — прогон).
 */
import { Worker, type Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { closePool, db } from '../db/client'
import { jobRuns } from '../db/schema'
import { DouClient } from '../lib/dou/client'
import { douConfig, workerConfig } from '../lib/env'
import { handlers, SCHEDULE } from './jobs'
import { closeQueues, QUEUE_NAMES, queues, type QueueKey } from './queue'
import { createRedis } from './redis'

const { jobsConcurrency, llmConcurrency } = workerConfig()

/** Регистрирует/обновляет повторяющиеся задачи. Идемпотентно. */
async function syncSchedule(): Promise<void> {
  const wanted = new Map<QueueKey, Set<string>>()

  for (const job of SCHEDULE) {
    await queues[job.queue].upsertJobScheduler(
      job.name,
      { pattern: job.pattern },
      { name: job.name },
    )
    if (!wanted.has(job.queue)) wanted.set(job.queue, new Set())
    wanted.get(job.queue)!.add(job.name)
    console.log(`[schedule] ${job.queue}/${job.name} — ${job.pattern} (${job.description})`)
  }

  // Снимаем расписания, удалённые из SCHEDULE.
  for (const key of Object.keys(queues) as QueueKey[]) {
    const keep = wanted.get(key) ?? new Set<string>()
    for (const scheduler of await queues[key].getJobSchedulers()) {
      if (scheduler.key && !keep.has(scheduler.key)) {
        await queues[key].removeJobScheduler(scheduler.key)
        console.log(`[schedule] снято устаревшее расписание ${key}/${scheduler.key}`)
      }
    }
  }
}

const httpRedis = createRedis('http')
const douClient = new DouClient(httpRedis)

/**
 * Обёртка вокруг насоса: журналирует прогон и превращает просьбу
 * о паузе в Worker.RateLimitError.
 *
 * Пауза записывается как успешный прогон с пометкой в meta, а не как
 * сбой: насос отработал корректно, это источник попросил подождать.
 */
function makeProcessor(worker: () => Worker) {
  return async function processJob(job: Job): Promise<void> {
    const handler = handlers[job.name]
    if (!handler) throw new Error(`нет обработчика для задачи «${job.name}»`)

    const attempt = job.attemptsMade + 1
    const startedAt = new Date()
    const label = `[${job.name}]`

    const [run] = await db
      .insert(jobRuns)
      .values({
        jobName: job.name,
        queueJobId: job.id ?? null,
        attempt,
        status: 'running',
        startedAt,
      })
      .returning({ id: jobRuns.id })

    const finish = async (
      status: 'success' | 'failed',
      extra: { itemsProcessed?: number; meta?: Record<string, unknown>; error?: string },
    ) => {
      if (!run) return
      const finishedAt = new Date()
      await db
        .update(jobRuns)
        .set({
          status,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          itemsProcessed: extra.itemsProcessed ?? 0,
          error: extra.error ?? null,
          meta: extra.meta ?? null,
        })
        .where(eq(jobRuns.id, run.id))
    }

    try {
      const result = await handler({
        attempt,
        client: douClient,
        log: (message) => console.log(`${label} ${message}`),
      })

      await finish('success', {
        itemsProcessed: result.itemsProcessed,
        meta: result.cooldownMs ? { ...result.meta, cooldownMs: result.cooldownMs } : result.meta,
      })

      if (result.cooldownMs && result.cooldownMs > 0) {
        // Пауза всей очереди: задание вернётся в ожидание, не сжигая попытку.
        await worker().rateLimit(result.cooldownMs)
        throw Worker.RateLimitError()
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'RateLimitError') throw error

      const message = error instanceof Error ? error.message : String(error)
      await finish('failed', { error: message })
      console.error(`${label} ошибка: ${message}`)
      throw error
    }
  }
}

const connections = {
  jobs: createRedis('worker-jobs'),
  fetch: createRedis('worker-fetch'),
  llm: createRedis('worker-llm'),
}

const workers: Partial<Record<QueueKey, Worker>> = {}

workers.jobs = new Worker(QUEUE_NAMES.jobs, makeProcessor(() => workers.jobs!), {
  connection: connections.jobs,
  concurrency: jobsConcurrency,
})

/**
 * Единственный Worker, который ходит в сеть: concurrency 1 плюс limiter
 * задают вежливый темп независимо от того, сколько задач стоит в очереди.
 */
workers.fetch = new Worker(QUEUE_NAMES.fetch, makeProcessor(() => workers.fetch!), {
  connection: connections.fetch,
  concurrency: 1,
  limiter: { max: 1, duration: douConfig().minIntervalMs },
})

workers.llm = new Worker(QUEUE_NAMES.llm, makeProcessor(() => workers.llm!), {
  connection: connections.llm,
  concurrency: llmConcurrency,
})

for (const [key, worker] of Object.entries(workers)) {
  worker!.on('ready', () => console.log(`[worker:${key}] готов`))
  worker!.on('error', (error) => console.error(`[worker:${key}] ошибка:`, error))
}

await syncSchedule()
console.log(`[worker] запущен, concurrency jobs=${jobsConcurrency}, fetch=1, llm=${llmConcurrency}`)

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[worker] ${signal} — завершаюсь`)
  try {
    await Promise.all(Object.values(workers).map((w) => w!.close()))
    await closeQueues()
    await Promise.all([...Object.values(connections), httpRedis].map((c) => c.quit()))
    await closePool()
  } catch (error) {
    console.error('[worker] ошибка при остановке:', error)
  }
  process.exit(0)
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal))
}
