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
  {
    name: 'parse',
    queue: 'jobs',
    pattern: '*/5 * * * *',
    description: 'Разбор страниц: акты, люди, решения',
  },
  {
    name: 'canonize',
    queue: 'jobs',
    pattern: '*/5 * * * *',
    description: 'Канонизация причин отказа правилами',
  },
  {
    name: 'enrich',
    queue: 'llm',
    pattern: '*/10 * * * *',
    description: 'Обогащение остатка причин через LLM',
  },
  {
    name: 'link-appeals',
    queue: 'jobs',
    // Ночью: пересчёт полный по всей истории, и связь меняется только
    // при появлении новых решений, то есть раз в несколько дней.
    pattern: '23 2 * * *',
    description: 'Связь подтверждений отказа с первичными и повторные публикации',
  },
  {
    name: 'rollup',
    queue: 'jobs',
    pattern: '*/5 * * * *',
    description: 'Пересчёт суточных витрин по затронутым дням',
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
  parse: parsePages,
  canonize: canonizeReasons,
  enrich: enrichReasons,
  'link-appeals': linkAppealsAndRepublications,
  rollup: rollupDays,
}
