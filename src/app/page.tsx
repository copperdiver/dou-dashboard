import { AutoRefresh } from '@/components/auto-refresh'
import { JobsSummary } from '@/components/jobs-summary'
import { RecentRuns } from '@/components/recent-runs'
import { RunsChart, RunsChartLegend } from '@/components/runs-chart'
import { StatTile } from '@/components/stat-tile'
import { ThemeToggle } from '@/components/theme-toggle'
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

export default async function DashboardPage() {
  let data: Awaited<ReturnType<typeof loadDashboard>>
  try {
    data = await loadDashboard()
  } catch (error) {
    return <DatabaseUnavailable message={(error as Error).message} />
  }

  const { kpis, daily, jobs, recent } = data

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">DOU Dashboard</h1>
          <p className="mt-1 text-xs text-ink-secondary">
            Фоновые задачи и статистика их выполнения
            {kpis.running > 0 && <> · сейчас выполняется: {formatNumber(kpis.running)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <AutoRefresh />
          <ThemeToggle />
        </div>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Запусков за 24 часа"
          value={formatCompact(kpis.runs24h)}
          change={relativeChange(kpis.runs24h, kpis.runsPrev24h)}
          hint={kpis.runsPrev24h === 0 ? 'нет данных за прошлые сутки' : undefined}
        />
        <StatTile
          label="Доля успешных"
          value={formatPercent(kpis.successRate24h)}
          change={relativeChange(kpis.successRate24h, kpis.successRatePrev24h)}
          hint={kpis.runs24h === 0 ? 'запусков не было' : undefined}
        />
        <StatTile
          label="Ошибок за 24 часа"
          value={formatNumber(kpis.failed24h)}
          change={relativeChange(kpis.failed24h, kpis.failedPrev24h)}
          betterWhenUp={false}
          hint={kpis.failedPrev24h === 0 ? 'сутки назад ошибок не было' : undefined}
        />
        <StatTile
          label="Среднее время выполнения"
          value={formatDuration(kpis.avgDurationMs24h)}
          change={relativeChange(kpis.avgDurationMs24h, kpis.avgDurationMsPrev24h)}
          betterWhenUp={false}
          hint={kpis.avgDurationMs24h === null ? 'успешных запусков не было' : undefined}
        />
      </section>

      <section className="mt-4 rounded-xl border border-hairline bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Запуски задач по суткам</h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Последние {daily.length} дней · обработано записей за сутки:{' '}
              {formatCompact(kpis.itemsProcessed24h)}
            </p>
          </div>
          <RunsChartLegend />
        </div>
        <div className="mt-4">
          <RunsChart data={daily} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-hairline bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Задачи за неделю</h2>
          <p className="mt-0.5 mb-3 text-xs text-ink-secondary">
            Всего запусков в журнале: {formatCompact(kpis.totalRuns)}
          </p>
          <JobsSummary jobs={jobs} />
        </section>

        <section className="rounded-xl border border-hairline bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Расписание</h2>
          <p className="mt-0.5 mb-3 text-xs text-ink-secondary">
            Регистрируется воркером при старте · <code>src/worker/jobs.ts</code>
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
        <h2 className="mb-3 text-sm font-semibold text-ink">Последние запуски</h2>
        <RecentRuns runs={recent} />
      </section>
    </main>
  )
}

async function loadDashboard() {
  const [kpis, daily, jobs, recent] = await Promise.all([
    getKpis(),
    getDailyRuns(14),
    getJobSummaries(),
    getRecentRuns(12),
  ])
  return { kpis, daily, jobs, recent }
}

function DatabaseUnavailable({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight text-ink">DOU Dashboard</h1>
      <div className="mt-4 rounded-xl border border-hairline bg-surface p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="text-critical" aria-hidden="true">
            ✕
          </span>
          База данных недоступна
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-page p-3 text-xs text-ink-secondary">
          {message}
        </pre>
        <ol className="mt-4 space-y-1.5 text-xs text-ink-secondary">
          <li>
            1. Скопируйте <code className="text-ink">.env.example</code> в{' '}
            <code className="text-ink">.env</code>
          </li>
          <li>
            2. Поднимите зависимости:{' '}
            <code className="text-ink">docker compose -f docker-compose.dev.yml up -d</code>
          </li>
          <li>
            3. Примените миграции: <code className="text-ink">npm run db:migrate</code>
          </li>
          <li>
            4. Залейте справочники:{' '}
            <code className="text-ink">npm run db:seed-reference</code>
          </li>
        </ol>
      </div>
    </main>
  )
}
