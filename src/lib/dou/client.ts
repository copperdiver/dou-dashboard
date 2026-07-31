import type { Redis } from 'ioredis'
import { douConfig } from '../env'

/**
 * HTTP-клиент к in.gov.br.
 *
 * Сбои различаются по типу, а не сваливаются в один ретрай: 403 — это WAF,
 * и повторять его сразу бессмысленно и вредно, тогда как 5xx транзиентен,
 * а 404 означает снятую публикацию и повторять её не нужно никогда.
 */

export type DouResponse =
  | { kind: 'ok'; status: number; body: string }
  /** Публикация снята — больше не пытаться. */
  | { kind: 'gone'; status: number }
  /** WAF. Требует паузы всей очереди, а не повторной попытки. */
  | { kind: 'forbidden'; status: number; cooldownMs: number }
  /** Транзиентный сбой: имеет смысл повторить с экспонентой. */
  | { kind: 'transient'; status: number | null; message: string }
  /** Исчерпан суточный бюджет запросов — страховка от бесконечного цикла. */
  | { kind: 'budget_exhausted'; used: number; limit: number }

const COOLDOWN_KEY = 'dou:cooldown:until'
const STREAK_KEY = 'dou:forbidden:streak'
const BUDGET_PREFIX = 'dou:budget:'

export class DouClient {
  private lastRequestAt = 0

  constructor(private readonly redis: Redis) {}

  /** Мс до конца паузы, наложенной предыдущими 403. 0 — паузы нет. */
  async cooldownRemainingMs(): Promise<number> {
    const raw = await this.redis.get(COOLDOWN_KEY)
    if (!raw) return 0
    const until = Number.parseInt(raw, 10)
    if (!Number.isFinite(until)) return 0
    return Math.max(0, until - Date.now())
  }

  async get(url: string): Promise<DouResponse> {
    const cfg = douConfig()

    const budget = await this.consumeBudget(cfg.maxRequestsPerDay)
    if (!budget.ok) {
      return { kind: 'budget_exhausted', used: budget.used, limit: cfg.maxRequestsPerDay }
    }

    await this.throttle(cfg.minIntervalMs)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs)

    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': cfg.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6',
          'Cache-Control': 'no-cache',
        },
      })

      if (response.status === 403 || response.status === 429) {
        const cooldownMs = await this.registerForbidden(cfg)
        return { kind: 'forbidden', status: response.status, cooldownMs }
      }

      if (response.status === 404 || response.status === 410) {
        await this.resetForbiddenStreak()
        return { kind: 'gone', status: response.status }
      }

      if (!response.ok) {
        return {
          kind: 'transient',
          status: response.status,
          message: `HTTP ${response.status} ${response.statusText}`,
        }
      }

      const body = await response.text()
      await this.resetForbiddenStreak()
      return { kind: 'ok', status: response.status, body }
    } catch (error) {
      return { kind: 'transient', status: null, message: describeFetchError(error) }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async throttle(minIntervalMs: number): Promise<void> {
    const wait = this.lastRequestAt + minIntervalMs - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }

  /**
   * Счётчик по календарным суткам UTC. Дата берётся из системного времени
   * и относится к нашим запросам, а не к дате выпуска DOU, — путать их
   * нельзя, но здесь смещение часового пояса безобидно.
   */
  private async consumeBudget(limit: number): Promise<{ ok: boolean; used: number }> {
    const key = `${BUDGET_PREFIX}${new Date().toISOString().slice(0, 10)}`
    const used = await this.redis.incr(key)
    if (used === 1) await this.redis.expire(key, 2 * 24 * 60 * 60)
    return { ok: used <= limit, used }
  }

  /**
   * Наращивает серию 403 и возвращает длительность паузы: короткая при
   * первых отказах, длинная — когда WAF явно закрыл доступ.
   */
  private async registerForbidden(cfg: ReturnType<typeof douConfig>): Promise<number> {
    const streak = await this.redis.incr(STREAK_KEY)
    if (streak === 1) await this.redis.expire(STREAK_KEY, 6 * 60 * 60)

    const cooldownMs = streak >= cfg.forbiddenStreakLimit ? cfg.longCooldownMs : cfg.forbiddenCooldownMs
    await this.redis.set(COOLDOWN_KEY, String(Date.now() + cooldownMs), 'PX', cooldownMs)
    return cooldownMs
  }

  private async resetForbiddenStreak(): Promise<void> {
    await this.redis.del(STREAK_KEY)
  }
}

/**
 * Разворачивает ошибку сети в читаемую строку.
 *
 * Node на любом сбое соединения бросает `TypeError: fetch failed`, а
 * настоящую причину кладёт в `cause`: ENOTFOUND, ECONNREFUSED, ETIMEDOUT,
 * ошибка сертификата. Без неё в журнале и в `ingest_days.last_error`
 * оставалось «fetch failed», по которому нельзя отличить упавший DNS
 * от закрытого файрвола.
 *
 * Обрыв по таймауту распознаётся отдельно: AbortController отменяет
 * запрос сам, и без пояснения это выглядит как загадочная отмена.
 */
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return 'таймаут запроса'
  }

  const cause = error.cause as { code?: string; message?: string } | undefined
  const detail = cause?.code ?? cause?.message

  return detail ? `${error.message}: ${detail}` : error.message
}

/** URL дневного индекса выпуска. */
export function dailyIndexUrl(editionDate: string, section: string): string {
  const [year, month, day] = editionDate.split('-')
  return `${douConfig().baseUrl}/leiturajornal?data=${day}-${month}-${year}&secao=${section}`
}

/** URL страницы статьи. */
export function articleUrl(urlTitle: string): string {
  return `${douConfig().baseUrl}/web/dou/-/${urlTitle}`
}
