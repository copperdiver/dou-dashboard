import type { JobSummary } from '@/lib/stats'
import { formatDateTime, formatDuration, formatNumber, formatPercent } from '@/lib/format'

export function JobsSummary({ jobs }: { jobs: JobSummary[] }) {
  if (jobs.length === 0) {
    return <p className="text-xs text-ink-secondary">За последнюю неделю запусков не было.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-hairline text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Задача</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Запусков</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Доля ошибок</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Среднее время</th>
            <th scope="col" className="py-2 font-medium">Последний запуск</th>
          </tr>
        </thead>
        <tbody className="[font-variant-numeric:tabular-nums]">
          {jobs.map((job) => (
            <tr key={job.jobName} className="border-b border-hairline last:border-0">
              <th scope="row" className="py-2 pr-3 font-normal text-ink">{job.jobName}</th>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatNumber(job.runs)}
              </td>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatPercent(job.runs > 0 ? job.failed / job.runs : null)}
              </td>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatDuration(job.avgDurationMs)}
              </td>
              <td className="py-2 text-ink-secondary">{formatDateTime(job.lastRunAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
