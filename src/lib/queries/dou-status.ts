import IORedis from 'ioredis'
import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { ingestDays, jobRuns, sourcePages } from '../../db/schema'
import { isProxyConfigured } from '../dou/client'
import { douConfig } from '../env'

/**
 * Состояние связи с in.gov.br.
 *
 * Собирается из того, что конвейер уже знает: пауза после 403 и суточный
 * расход запросов лежат в Redis, история попыток — в `ingest_days`
 * и `job_runs`. Своего запроса к источнику здесь нет намеренно.
 *
 * Пинговать DOU при каждом показе страницы нельзя по трём причинам:
 * запрос попал бы в суточный бюджет, участил бы обращения сверх
 * `DOU_MIN_INTERVAL_MS` и мог бы разбудить тот самый WAF, ради которого
 * написаны паузы и серии отказов. К тому же настоящий трафик насосов
 * говорит о доступности больше, чем синтетическая проверка: он ходит
 * по реальным адресам и с реальной частотой.
 *
 * Разовая проверка по требованию живёт отдельно — см. `probeDou`.
 */

const COOLDOWN_KEY = 'dou:cooldown:until'
const STREAK_KEY = 'dou:forbidden:streak'
const BUDGET_PREFIX = 'dou:budget:'
const PROBE_KEY = 'dou:probe:last'

export type DouProbe = {
  at: string
  ok: boolean
  /** HTTP-код либо null, если до ответа дело не дошло. */
  status: number | null
  message: string
  durationMs: number
}

export type DouStatus = {
  /** Мс до конца паузы после 403. 0 — паузы нет. */
  cooldownMs: number
  /** Сколько 403 подряд получено. */
  forbiddenStreak: number
  budget: { used: number; limit: number }
  /** Последний УСПЕШНЫЙ разбор дневного индекса. */
  lastSuccessAt: string | null
  /** Последняя неудача с причиной, как её записал клиент. */
  lastFailure: { day: string; error: string; attempts: number } | null
  /** Дни, окончательно упавшие и ждущие ручного сброса. */
  failedDays: number
  /** Страницы, ожидающие загрузки. */
  pendingPages: number
  /** Последняя проверка по кнопке. */
  probe: DouProbe | null
  redisAvailable: boolean
  /** Идёт ли трафик к источнику через прокси. */
  viaProxy: boolean
}

/**
 * Своё соединение с Redis, а не общее с очередями: те живут в воркере,
 * а это читает веб. Соединение ленивое и переиспользуется между
 * запросами — открывать его на каждый показ страницы дорого.
 */
let redis: IORedis | null = null

/**
 * Возвращает ПОДКЛЮЧЁННОЕ соединение либо null.
 *
 * Подключение — часть получения, а не забота вызывающего: соединение
 * ленивое и с выключенной офлайн-очередью, поэтому команда на неподнятом
 * сокете падает сразу. Один раз на этом уже споткнулись.
 */
export async function getRedis(): Promise<IORedis | null> {
  if (!process.env.REDIS_URL) return null
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      // Страница состояния не должна ждать недоступный Redis: без него
      // она просто покажет остальные показатели.
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    })
    redis.on('error', () => {})
  }

  if (redis.status === 'wait' || redis.status === 'end') {
    try {
      await redis.connect()
    } catch {
      return null
    }
  }

  return redis
}

export async function getDouStatus(): Promise<DouStatus> {
  const cfg = douConfig()
  const today = new Date().toISOString().slice(0, 10)

  const [fromRedis, lastSuccess, lastFailure, counts] = await Promise.all([
    readRedis(today),
    db.execute<{ at: string | null }>(sql`
      select to_char(max(completed_at), 'YYYY-MM-DD"T"HH24:MI:SSOF') as at
        from ${ingestDays} where status = 'enumerated'
    `),
    db.execute<{ day: string; err: string; attempts: number }>(sql`
      select to_char(edition_date, 'YYYY-MM-DD') as day,
             coalesce(last_error, '') as err, attempts
        from ${ingestDays}
       where last_error is not null
       order by started_at desc nulls last
       limit 1
    `),
    db.execute<{ failed_days: number; pending_pages: number }>(sql`
      select
        (select count(*)::int from ${ingestDays} where status = 'failed')        as failed_days,
        (select count(*)::int from ${sourcePages}
          where fetch_status in ('pending', 'failed'))                           as pending_pages
    `),
  ])

  const failure = lastFailure.rows[0]

  return {
    ...fromRedis,
    budget: { used: fromRedis.budget.used, limit: cfg.maxRequestsPerDay },
    lastSuccessAt: lastSuccess.rows[0]?.at ?? null,
    lastFailure: failure ? { day: failure.day, error: failure.err, attempts: failure.attempts } : null,
    failedDays: counts.rows[0]?.failed_days ?? 0,
    pendingPages: counts.rows[0]?.pending_pages ?? 0,
    viaProxy: isProxyConfigured(),
  }
}

async function readRedis(today: string): Promise<{
  cooldownMs: number
  forbiddenStreak: number
  budget: { used: number; limit: number }
  probe: DouProbe | null
  redisAvailable: boolean
}> {
  const empty = {
    cooldownMs: 0,
    forbiddenStreak: 0,
    budget: { used: 0, limit: 0 },
    probe: null,
    redisAvailable: false,
  }

  const client = await getRedis()
  if (!client) return empty

  try {
    const [cooldown, streak, used, probe] = await client.mget(
      COOLDOWN_KEY,
      STREAK_KEY,
      `${BUDGET_PREFIX}${today}`,
      PROBE_KEY,
    )

    const until = Number.parseInt(cooldown ?? '', 10)

    return {
      cooldownMs: Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0,
      forbiddenStreak: Number.parseInt(streak ?? '0', 10) || 0,
      budget: { used: Number.parseInt(used ?? '0', 10) || 0, limit: 0 },
      probe: probe ? (JSON.parse(probe) as DouProbe) : null,
      redisAvailable: true,
    }
  } catch {
    // Redis недоступен — это само по себе показатель, но остальные
    // сведения из базы всё равно нужно отдать.
    return empty
  }
}

/** Сохраняет результат разовой проверки, чтобы страница его показала. */
export async function saveProbe(probe: DouProbe): Promise<void> {
  const client = await getRedis()
  if (!client) return
  try {
    // Час жизни: более старая проверка ничего не говорит о «сейчас».
    await client.set(PROBE_KEY, JSON.stringify(probe), 'EX', 3600)
  } catch {
    // Не смогли записать — проверка всё равно уже выполнена и показана.
  }
}

/** Когда последний раз успешно ходили за страницей статьи. */
export async function getLastFetchRun(): Promise<string | null> {
  const { rows } = await db.execute<{ at: string | null }>(sql`
    select to_char(max(started_at), 'YYYY-MM-DD"T"HH24:MI:SSOF') as at
      from ${jobRuns}
     where job_name = 'fetch' and status = 'success'
  `)
  return rows[0]?.at ?? null
}
