import { DouClient, dailyIndexUrl } from './client'
import { douConfig } from '../env'
import { getRedis, saveProbe, type DouProbe } from '../queries/dou-status'

/**
 * A one-off connectivity check against the source, on demand, not on a
 * timer.
 *
 * Goes through the regular `DouClient`, not a bare fetch: this way the
 * check obeys the same rules as the pumps (the minimum interval, the
 * daily budget, and the cooldown after a 403). A check that bypasses these
 * rules could trigger the very block it's meant to diagnose.
 *
 * Requests today's daily index: the exact address where `enumerate`
 * trips up, not the site root. The root can respond even when the
 * relevant section is already closed.
 */
export async function probeDou(): Promise<DouProbe> {
  const redis = await getRedis()
  const at = new Date().toISOString()

  if (!redis) {
    return { at, ok: false, status: null, message: 'REDIS_URL not set', durationMs: 0 }
  }

  const cfg = douConfig()
  const today = new Date().toISOString().slice(0, 10)
  // There can be multiple sections; the first one is enough for a connectivity check.
  const section = cfg.sections[0] ?? 'do1'

  const client = new DouClient(redis)
  const started = Date.now()

  const cooldown = await client.cooldownRemainingMs()
  if (cooldown > 0) {
    const probe: DouProbe = {
      at,
      ok: false,
      status: null,
      message: `source is cooling down after a 403, ${Math.ceil(cooldown / 1000)}s left`,
      durationMs: 0,
    }
    await saveProbe(probe)
    return probe
  }

  const response = await client.get(dailyIndexUrl(today, section))
  const durationMs = Date.now() - started

  const probe: DouProbe = { at, durationMs, ...describe(response) }
  await saveProbe(probe)
  return probe
}

function describe(
  response: Awaited<ReturnType<DouClient['get']>>,
): { ok: boolean; status: number | null; message: string } {
  switch (response.kind) {
    case 'ok':
      return { ok: true, status: response.status, message: `HTTP ${response.status}` }
    case 'gone':
      return { ok: false, status: response.status, message: `HTTP ${response.status}: edition was pulled` }
    case 'forbidden':
      return {
        ok: false,
        status: response.status,
        message: `HTTP ${response.status}: source blocked access, cooldown ${Math.round(
          response.cooldownMs / 1000,
        )}s`,
      }
    case 'budget_exhausted':
      return {
        ok: false,
        status: null,
        message: `daily request budget exhausted (${response.used} of ${response.limit})`,
      }
    case 'transient':
      return { ok: false, status: response.status, message: response.message }
  }
}
