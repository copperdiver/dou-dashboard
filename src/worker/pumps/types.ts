import type { DouClient } from '../../lib/dou/client'

export type PumpContext = {
  /** Пишет строку в лог воркера с префиксом задачи. */
  log: (message: string) => void
  attempt: number
  client: DouClient
}

export type PumpResult = {
  /** Сколько единиц работы обработано — попадает в job_runs.items_processed. */
  itemsProcessed?: number
  /** Детали прогона: job_runs хранит одну строку на прогон, а не на элемент. */
  meta?: Record<string, unknown>
  /**
   * Просьба поставить очередь на паузу: источник ответил 403.
   * Обрабатывается в воркере через Worker.RateLimitError, чтобы задание
   * вернулось в ожидание, не сжигая попытку.
   */
  cooldownMs?: number
}

export type Pump = (ctx: PumpContext) => Promise<PumpResult>
