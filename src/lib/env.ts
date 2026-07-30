/**
 * Чтение конфигурации из окружения с явными значениями по умолчанию.
 *
 * Разбор ленивый (через функции, а не константы модуля): `next build`
 * импортирует модули роутов, и падение на отсутствующей переменной
 * ломало бы сборку образа, где переменных ещё нет.
 */

function str(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

/**
 * Значение переменной или `undefined`, если она не задана либо пуста.
 *
 * Нужно именно так, а не через `??`: docker compose для незаданной
 * переменной вида `${FOO:-}` подставляет ПУСТУЮ СТРОКУ, а `??`
 * срабатывает только на null и undefined. Из-за этого имя модели
 * становилось пустым и уходило в API как `model: ""`.
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
    throw new Error(`${name} должно быть целым числом, получено «${raw}»`)
  }
  return parsed
}

/**
 * User-Agent обязателен: с UA по умолчанию (`node`, `python-urllib`)
 * in.gov.br отвечает 403 — проверено, urllib получает 403 там, где curl
 * с браузерным UA получает 200.
 */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

export function douConfig() {
  return {
    baseUrl: str('DOU_BASE_URL', 'https://www.in.gov.br'),
    userAgent: str('DOU_USER_AGENT', DEFAULT_USER_AGENT),
    /** Минимальный интервал между запросами к источнику. */
    minIntervalMs: int('DOU_MIN_INTERVAL_MS', 2000),
    /** Страховка от бесконечного цикла: жёсткий потолок запросов в сутки. */
    maxRequestsPerDay: int('DOU_MAX_REQUESTS_PER_DAY', 5000),
    /** Пауза очереди после серии 403. */
    forbiddenCooldownMs: int('DOU_FORBIDDEN_COOLDOWN_MS', 15 * 60 * 1000),
    /** Сколько 403 подряд до длинной паузы. */
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
    /** Насколько назад смотрит discover: DOU публикует с задержкой и правит выпуски. */
    discoverLookbackDays: int('DISCOVER_LOOKBACK_DAYS', 7),
    enumerateBatch: int('ENUMERATE_BATCH', 5),
    fetchBatch: int('FETCH_BATCH', 10),
    /** Попыток на день/страницу до статуса failed. */
    maxAttempts: int('INGEST_MAX_ATTEMPTS', 5),
    /** Аренда взятой в работу строки: истекла — можно брать заново. */
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
