/**
 * Реестр насосов и их расписание.
 *
 * Каждая задача — идемпотентный насос: забирает пачку работы из Postgres,
 * обрабатывает и завершается. Прогресс живёт в таблицах (`ingest_days`,
 * `source_pages`), а не в Redis, поэтому перезапуск воркера или очистка
 * очередей не рушат бэкфилл на 250 дней.
 *
 * Чтобы добавить насос: описать его в SCHEDULE и добавить обработчик
 * в handlers под тем же именем. Расписание синхронизируется при старте.
 */
import { discover } from './pumps/discover'
import { enumerate } from './pumps/enumerate'
import { fetchPages } from './pumps/fetch'
import type { Pump } from './pumps/types'
import type { QueueKey } from './queue'

export type ScheduledJob = {
  name: string
  /** В какой очереди исполняется: от этого зависят лимиты и concurrency. */
  queue: QueueKey
  /** Cron-выражение в часовом поясе процесса (см. TZ в .env). */
  pattern: string
  description: string
}

export const SCHEDULE: readonly ScheduledJob[] = [
  {
    name: 'heartbeat',
    queue: 'jobs',
    pattern: '*/5 * * * *',
    description: 'Пульс: проверяет, что воркер и БД живы',
  },
  {
    name: 'discover',
    queue: 'jobs',
    pattern: '0 6,14 * * *',
    description: 'Ставит в очередь дни за последнюю неделю',
  },
  {
    name: 'enumerate',
    queue: 'fetch',
    pattern: '*/10 * * * *',
    description: 'Дневной индекс DOU → снапшот и список статей',
  },
  {
    name: 'fetch',
    queue: 'fetch',
    pattern: '*/5 * * * *',
    description: 'Загрузка страниц статей',
  },
] as const

export const handlers: Record<string, Pump> = {
  async heartbeat({ log }) {
    log('пульс')
    return { itemsProcessed: 1 }
  },
  discover,
  enumerate,
  fetch: fetchPages,
}
