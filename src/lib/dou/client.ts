import type { Redis } from 'ioredis'
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from 'undici'
import { douConfig } from '../env'

/**
 * HTTP client for in.gov.br.
 *
 * Failures are distinguished by type instead of falling into one retry
 * bucket: 403 is the WAF, and retrying it immediately is pointless and
 * harmful, while 5xx is transient, and 404 means the publication was
 * pulled and should never be retried.
 */

export type DouResponse =
  | { kind: 'ok'; status: number; body: string }
  /** Publication was pulled. Stop trying. */
  | { kind: 'gone'; status: number }
  /** WAF. Requires pausing the whole queue, not a retry. */
  | { kind: 'forbidden'; status: number; cooldownMs: number }
  /** Transient failure: worth retrying with backoff. */
  | { kind: 'transient'; status: number | null; message: string }
  /** Daily request budget exhausted (a safeguard against an infinite loop). */
  | { kind: 'budget_exhausted'; used: number; limit: number }

const COOLDOWN_KEY = 'dou:cooldown:until'
const STREAK_KEY = 'dou:forbidden:streak'
const BUDGET_PREFIX = 'dou:budget:'

/*
 * Proxy only for requests to in.gov.br.
 *
 * Using environment variables (NODE_USE_ENV_PROXY) would be shorter, but
 * it would route ALL outgoing process traffic through the proxy, including
 * calls to the LLM. The proxy is residential and billed by the gigabyte,
 * and model responses are noticeably larger than edition pages, so the bill
 * would grow for no reason.
 *
 * The agent is created once: it holds a connection pool internally, and
 * recreating it on every request would defeat the pool entirely.
 */
let proxyAgent: ProxyAgent | null | undefined

function getProxyDispatcher(): Dispatcher | undefined {
  if (proxyAgent === undefined) {
    const url = process.env.DOU_PROXY_URL
    proxyAgent = url ? new ProxyAgent(url) : null
  }
  return proxyAgent ?? undefined
}

/** Whether traffic to the source goes through the proxy. Shown on the status page. */
export function isProxyConfigured(): boolean {
  return Boolean(process.env.DOU_PROXY_URL)
}

/*
 * Requests go through `fetch` FROM THE undici PACKAGE, not the global one.
 *
 * Node's global `fetch` runs on its own bundled copy of undici and won't
 * accept a foreign `ProxyAgent`: the request fails with `UND_ERR_INVALID_ARG`
 * instead of going through the proxy. Verified: with the package's
 * `fetch`, the same agent gives an honest `ECONNREFUSED` on a closed port.
 */

export class DouClient {
  private lastRequestAt = 0

  constructor(private readonly redis: Redis) {}

  /** Ms until the cooldown from previous 403s ends. 0 means no cooldown. */
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
      const response = await undiciFetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        dispatcher: getProxyDispatcher(),
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
   * Counter keyed by calendar UTC day. The date comes from system time and
   * refers to our own requests, not the DOU edition date. The two must
   * not be confused, but the timezone offset here is harmless.
   */
  private async consumeBudget(limit: number): Promise<{ ok: boolean; used: number }> {
    const key = `${BUDGET_PREFIX}${new Date().toISOString().slice(0, 10)}`
    const used = await this.redis.incr(key)
    if (used === 1) await this.redis.expire(key, 2 * 24 * 60 * 60)
    return { ok: used <= limit, used }
  }

  /**
   * Increments the 403 streak and returns the cooldown duration: short for
   * the first refusals, long once the WAF has clearly locked us out.
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
 * Unwraps a network error into a readable string.
 *
 * Node throws `TypeError: fetch failed` on any connection failure and
 * puts the real reason in `cause`: ENOTFOUND, ECONNREFUSED, ETIMEDOUT, a
 * certificate error. Without it, the log and `ingest_days.last_error`
 * were left with just "fetch failed", which can't tell a broken DNS from
 * a closed firewall.
 *
 * A timeout abort is recognized separately: AbortController cancels the
 * request itself, and without an explanation this looks like a mysterious
 * cancellation.
 *
 * The cause chain is unwrapped in full, not just one level. A proxy
 * refusal inside the undici tunnel gets wrapped twice, and the first
 * level only shows "Request was cancelled", a message that can't
 * distinguish a proxy that closed the domain from a dropped connection.
 * The real reason ("Proxy response (403) !== 200 when HTTP Tunneling")
 * sits deeper.
 */
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return 'request timeout'
  }

  type Cause = { code?: string; message?: string; cause?: unknown } | undefined

  const details: string[] = []
  let cause = error.cause as Cause
  // Depth limit (a safeguard against a circular cause chain).
  for (let depth = 0; cause && depth < 5; depth += 1) {
    const detail = cause.code ?? cause.message
    if (detail && !details.includes(detail)) details.push(detail)
    cause = cause.cause as Cause
  }

  return details.length ? `${error.message}: ${details.join(' ← ')}` : error.message
}

/** URL of the daily edition index. */
export function dailyIndexUrl(editionDate: string, section: string): string {
  const [year, month, day] = editionDate.split('-')
  return `${douConfig().baseUrl}/leiturajornal?data=${day}-${month}-${year}&secao=${section}`
}

/** URL of the article page. */
export function articleUrl(urlTitle: string): string {
  return `${douConfig().baseUrl}/web/dou/-/${urlTitle}`
}
