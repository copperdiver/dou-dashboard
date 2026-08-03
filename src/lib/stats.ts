import { desc, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { jobRuns, type JobRun } from '../db/schema'

export type Kpis = {
  runs24h: number
  runsPrev24h: number
  failed24h: number
  failedPrev24h: number
  /** Share of successful runs, 0..1. null means there were no runs. */
  successRate24h: number | null
  successRatePrev24h: number | null
  /** Average duration of a successful run, ms. */
  avgDurationMs24h: number | null
  avgDurationMsPrev24h: number | null
  itemsProcessed24h: number
  itemsProcessedPrev24h: number
  running: number
  totalRuns: number
}

type KpiRow = {
  runs_24h: number
  runs_prev_24h: number
  failed_24h: number
  failed_prev_24h: number
  success_24h: number
  success_prev_24h: number
  avg_duration_24h: string | null
  avg_duration_prev_24h: string | null
  items_24h: number
  items_prev_24h: number
  running: number
  total_runs: number
}

const LAST_24H = sql`started_at >= now() - interval '24 hours'`
const PREV_24H = sql`started_at >= now() - interval '48 hours' and started_at < now() - interval '24 hours'`

export async function getKpis(): Promise<Kpis> {
  const result = await db.execute<KpiRow>(sql`
    select
      count(*) filter (where ${LAST_24H})::int                                   as runs_24h,
      count(*) filter (where ${PREV_24H})::int                                   as runs_prev_24h,
      count(*) filter (where ${LAST_24H} and status = 'failed')::int             as failed_24h,
      count(*) filter (where ${PREV_24H} and status = 'failed')::int             as failed_prev_24h,
      count(*) filter (where ${LAST_24H} and status = 'success')::int            as success_24h,
      count(*) filter (where ${PREV_24H} and status = 'success')::int            as success_prev_24h,
      avg(duration_ms) filter (where ${LAST_24H} and status = 'success')         as avg_duration_24h,
      avg(duration_ms) filter (where ${PREV_24H} and status = 'success')         as avg_duration_prev_24h,
      coalesce(sum(items_processed) filter (where ${LAST_24H}), 0)::int          as items_24h,
      coalesce(sum(items_processed) filter (where ${PREV_24H}), 0)::int          as items_prev_24h,
      count(*) filter (where status = 'running')::int                            as running,
      count(*)::int                                                              as total_runs
    from ${jobRuns}
  `)

  const row = result.rows[0]

  const runs24h = row?.runs_24h ?? 0
  const runsPrev24h = row?.runs_prev_24h ?? 0
  const success24h = row?.success_24h ?? 0
  const successPrev24h = row?.success_prev_24h ?? 0

  return {
    runs24h,
    runsPrev24h,
    failed24h: row?.failed_24h ?? 0,
    failedPrev24h: row?.failed_prev_24h ?? 0,
    successRate24h: runs24h > 0 ? success24h / runs24h : null,
    successRatePrev24h: runsPrev24h > 0 ? successPrev24h / runsPrev24h : null,
    avgDurationMs24h: toNumber(row?.avg_duration_24h),
    avgDurationMsPrev24h: toNumber(row?.avg_duration_prev_24h),
    itemsProcessed24h: row?.items_24h ?? 0,
    itemsProcessedPrev24h: row?.items_prev_24h ?? 0,
    running: row?.running ?? 0,
    totalRuns: row?.total_runs ?? 0,
  }
}

export type DailyRuns = {
  /**
   * Date in YYYY-MM-DD format. The axis label is built from it at render
   * time via `formatDayShort`: the date format depends on the page
   * language, and SQL doesn't know the selected locale.
   */
  day: string
  success: number
  failed: number
}

/**
 * Runs by day for the last `days` days, including today.
 * Days with no runs come back as zeros: otherwise the chart would have gaps.
 */
export async function getDailyRuns(days = 14): Promise<DailyRuns[]> {
  const result = await db.execute<{
    day: string
    success: number
    failed: number
  }>(sql`
    with days as (
      select generate_series(
        date_trunc('day', now()) - make_interval(days => ${days - 1}::int),
        date_trunc('day', now()),
        interval '1 day'
      ) as day
    )
    select
      to_char(d.day, 'YYYY-MM-DD')                                     as day,
      count(r.id) filter (where r.status = 'success')::int              as success,
      count(r.id) filter (where r.status = 'failed')::int               as failed
    from days d
    left join ${jobRuns} r
      on r.started_at >= d.day
     and r.started_at <  d.day + interval '1 day'
    group by d.day
    order by d.day
  `)

  return result.rows
}

export type JobSummary = {
  jobName: string
  runs: number
  failed: number
  avgDurationMs: number | null
  lastRunAt: Date | null
}

/** Stats breakdown by job for the last 7 days. */
export async function getJobSummaries(): Promise<JobSummary[]> {
  const result = await db.execute<{
    job_name: string
    runs: number
    failed: number
    avg_duration_ms: string | null
    last_run_at: string | null
  }>(sql`
    select
      job_name,
      count(*)::int                                              as runs,
      count(*) filter (where status = 'failed')::int              as failed,
      avg(duration_ms) filter (where status = 'success')          as avg_duration_ms,
      max(started_at)                                            as last_run_at
    from ${jobRuns}
    where started_at >= now() - interval '7 days'
    group by job_name
    order by runs desc
  `)

  return result.rows.map((row) => ({
    jobName: row.job_name,
    runs: row.runs,
    failed: row.failed,
    avgDurationMs: toNumber(row.avg_duration_ms),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
  }))
}

export async function getRecentRuns(limit = 12): Promise<JobRun[]> {
  return db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit)
}

/** avg() in Postgres returns numeric, and node-postgres hands it back as a string. */
function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
