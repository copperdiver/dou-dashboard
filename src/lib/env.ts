/**
 * Reads configuration from the environment with explicit defaults.
 *
 * Parsing is lazy (via functions, not module-level constants): `next
 * build` imports route modules, and failing on a missing variable would
 * break the image build, where the variables aren't set yet.
 */

function str(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

/**
 * The variable's value, or `undefined` if it's unset or empty.
 *
 * It has to work this way, not via `??`: for an unset variable of the
 * form `${FOO:-}`, docker compose substitutes an EMPTY STRING, and `??`
 * only triggers on null and undefined. Because of this, the model name
 * ended up empty and got sent to the API as `model: ""`.
 */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer, got "${raw}"`)
  }
  return parsed
}

/**
 * A User-Agent is mandatory: with the default UA (`node`,
 * `python-urllib`), in.gov.br responds with 403. Verified: urllib gets
 * 403 where curl with a browser UA gets 200.
 */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

export function douConfig() {
  return {
    baseUrl: str('DOU_BASE_URL', 'https://www.in.gov.br'),
    userAgent: str('DOU_USER_AGENT', DEFAULT_USER_AGENT),
    /** Minimum interval between requests to the source. */
    minIntervalMs: int('DOU_MIN_INTERVAL_MS', 2000),
    /** Safety net against an infinite loop: a hard daily request cap. */
    maxRequestsPerDay: int('DOU_MAX_REQUESTS_PER_DAY', 5000),
    /** Queue pause after a streak of 403s. */
    forbiddenCooldownMs: int('DOU_FORBIDDEN_COOLDOWN_MS', 15 * 60 * 1000),
    /** How many 403s in a row before the long cooldown. */
    forbiddenStreakLimit: int('DOU_FORBIDDEN_STREAK_LIMIT', 3),
    longCooldownMs: int('DOU_LONG_COOLDOWN_MS', 60 * 60 * 1000),
    requestTimeoutMs: int('DOU_REQUEST_TIMEOUT_MS', 45_000),
    sections: str('DOU_SECTIONS', 'do1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

export function pipelineConfig() {
  return {
    /** How far back discover looks: DOU publishes with a delay and edits editions. */
    discoverLookbackDays: int('DISCOVER_LOOKBACK_DAYS', 7),
    enumerateBatch: int('ENUMERATE_BATCH', 5),
    /**
     * After how many hours to retry a day with an empty index, while
     * that day hasn't ended yet in São Paulo time. The edition comes
     * out in the morning while polling starts at night, so an empty
     * index for the current day is normal, not "no edition".
     */
    emptyIndexRetryHours: int('ENUMERATE_EMPTY_RETRY_HOURS', 3),
    fetchBatch: int('FETCH_BATCH', 10),
    /** Attempts per day/page before the status becomes failed. */
    maxAttempts: int('INGEST_MAX_ATTEMPTS', 5),
    /** Lease on a claimed row: once expired, it can be claimed again. */
    claimLeaseMs: int('INGEST_CLAIM_LEASE_MS', 5 * 60 * 1000),
    backfillDays: int('BACKFILL_DAYS', 365),
  }
}

export function workerConfig() {
  return {
    jobsConcurrency: int('WORKER_CONCURRENCY', 2),
    llmConcurrency: int('WORKER_LLM_CONCURRENCY', 1),
  }
}
