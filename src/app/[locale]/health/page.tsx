import { notFound } from 'next/navigation'
import { AutoRefresh } from '@/components/auto-refresh'
import { JobsSummary } from '@/components/jobs-summary'
import { RecentRuns } from '@/components/recent-runs'
import { RunsChart, RunsChartLegend } from '@/components/runs-chart'
import { StatTile } from '@/components/stat-tile'
import { getTranslator, isLocale, type Locale } from '@/i18n'
import {
  formatCompact,
  formatDuration,
  formatNumber,
  formatPercent,
  relativeChange,
} from '@/lib/format'
import { getDailyRuns, getJobSummaries, getKpis, getRecentRuns } from '@/lib/stats'
import { SCHEDULE } from '@/worker/jobs'

// Дашборд всегда показывает свежие данные — прегенерация не нужна.
export const dynamic = 'force-dynamic'

const REFRESH_MS = 30_000
const CHART_DAYS = 14

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const { d, count, fill } = getTranslator(locale)

  let data: Awaited<ReturnType<typeof loadDashboard>>
  try {
    data = await loadDashboard()
  } catch (error) {
    return <DatabaseUnavailable locale={locale} message={(error as Error).message} />
  }

  const { kpis, daily, jobs, recent } = data
  const dayCount = count(daily.length, d.plurals.days)

  return (
    <>
      {/* Шапку и навигацию рисует layout — здесь только содержимое раздела. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-secondary">
          {kpis.running > 0
            ? fill(d.jobs.runningNow, { count: formatNumber(locale, kpis.running) })
            : null}
        </p>
        <AutoRefresh
          intervalMs={REFRESH_MS}
          labels={{
            every: fill(d.jobs.refreshEvery, { interval: formatDuration(locale, REFRESH_MS) }),
            refresh: d.common.refresh,
            refreshing: d.jobs.refreshing,
          }}
        />
      </div>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          locale={locale}
          label={d.jobs.runs24h}
          value={formatCompact(locale, kpis.runs24h)}
          change={relativeChange(kpis.runs24h, kpis.runsPrev24h)}
          comparedTo={d.jobs.comparedTo}
          unchangedLabel={d.common.unchanged}
          hint={kpis.runsPrev24h === 0 ? d.jobs.noPreviousDay : undefined}
        />
        <StatTile
          locale={locale}
          label={d.jobs.successRate}
          value={formatPercent(locale, kpis.successRate24h)}
          change={relativeChange(kpis.successRate24h, kpis.successRatePrev24h)}
          comparedTo={d.jobs.comparedTo}
          unchangedLabel={d.common.unchanged}
          hint={kpis.runs24h === 0 ? d.jobs.noRuns : undefined}
        />
        <StatTile
          locale={locale}
          label={d.jobs.failed24h}
          value={formatNumber(locale, kpis.failed24h)}
          change={relativeChange(kpis.failed24h, kpis.failedPrev24h)}
          betterWhenUp={false}
          comparedTo={d.jobs.comparedTo}
          unchangedLabel={d.common.unchanged}
          hint={kpis.failedPrev24h === 0 ? d.jobs.noFailuresBefore : undefined}
        />
        <StatTile
          locale={locale}
          label={d.jobs.avgDuration}
          value={formatDuration(locale, kpis.avgDurationMs24h)}
          change={relativeChange(kpis.avgDurationMs24h, kpis.avgDurationMsPrev24h)}
          betterWhenUp={false}
          comparedTo={d.jobs.comparedTo}
          unchangedLabel={d.common.unchanged}
          hint={kpis.avgDurationMs24h === null ? d.jobs.noSuccessfulRuns : undefined}
        />
      </section>

      <section className="mt-4 rounded-xl border border-hairline bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">{d.jobs.dailyTitle}</h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              {fill(d.jobs.dailyNote, {
                days: dayCount,
                items: formatCompact(locale, kpis.itemsProcessed24h),
              })}
            </p>
          </div>
          <RunsChartLegend labels={{ success: d.jobs.success, failure: d.jobs.failure }} />
        </div>
        <div className="mt-4">
          <RunsChart
            locale={locale}
            data={daily}
            dayCount={dayCount}
            labels={{
              dailyChartAlt: d.jobs.dailyChartAlt,
              emptyChart: d.jobs.emptyChart,
              colDate: d.jobs.colDate,
              success: d.jobs.success,
              failure: d.jobs.failure,
              showTable: d.common.showTable,
              total: d.common.total,
            }}
          />
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-hairline bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">{d.jobs.weekTitle}</h2>
          <p className="mt-0.5 mb-3 text-xs text-ink-secondary">
            {fill(d.jobs.weekNote, { count: formatCompact(locale, kpis.totalRuns) })}
          </p>
          <JobsSummary
            locale={locale}
            jobs={jobs}
            labels={{
              emptyWeek: d.jobs.emptyWeek,
              colJob: d.jobs.colJob,
              colRuns: d.jobs.colRuns,
              colFailureRate: d.jobs.colFailureRate,
              colAvgTime: d.jobs.colAvgTime,
              colLastRun: d.jobs.colLastRun,
            }}
          />
        </section>

        <section className="rounded-xl border border-hairline bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">{d.jobs.scheduleTitle}</h2>
          <p className="mt-0.5 mb-3 text-xs text-ink-secondary">
            {d.jobs.scheduleNote} · <code>src/worker/jobs.ts</code>
          </p>
          <ul className="space-y-2.5">
            {SCHEDULE.map((job) => (
              <li key={job.name} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-medium text-ink">{job.name}</span>
                <code className="rounded bg-page px-1.5 py-0.5 text-ink-secondary">
                  {job.pattern}
                </code>
                <span className="text-ink-muted">{job.description}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-hairline bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">{d.jobs.recentTitle}</h2>
        <RecentRuns
          locale={locale}
          runs={recent}
          labels={{
            emptyRecent: d.jobs.emptyRecent,
            colJob: d.jobs.colJob,
            colStatus: d.jobs.colStatus,
            colStartedAt: d.jobs.colStartedAt,
            colDuration: d.jobs.colDuration,
            colItems: d.jobs.colItems,
            colError: d.jobs.colError,
            attempt: d.jobs.attempt,
            statusSuccess: d.jobs.statusSuccess,
            statusFailed: d.jobs.statusFailed,
            statusRunning: d.jobs.statusRunning,
          }}
        />
      </section>
    </>
  )
}

async function loadDashboard() {
  const [kpis, daily, jobs, recent] = await Promise.all([
    getKpis(),
    getDailyRuns(CHART_DAYS),
    getJobSummaries(),
    getRecentRuns(12),
  ])
  return { kpis, daily, jobs, recent }
}

function DatabaseUnavailable({ locale, message }: { locale: Locale; message: string }) {
  const { d } = getTranslator(locale)

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-xl border border-hairline bg-surface p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="text-critical" aria-hidden="true">
            ✕
          </span>
          {d.db.unavailable}
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-page p-3 text-xs text-ink-secondary">
          {message}
        </pre>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-xs text-ink-secondary">
          <li>{d.db.step1}</li>
          <li>
            {d.db.step2}{' '}
            <code className="text-ink">docker compose -f docker-compose.dev.yml up -d</code>
          </li>
          <li>
            {d.db.step3} <code className="text-ink">npm run db:migrate</code>
          </li>
          <li>
            {d.db.step4} <code className="text-ink">npm run db:seed-reference</code>
          </li>
        </ol>
      </div>
    </div>
  )
}
