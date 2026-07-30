import type { Dictionary, Locale } from '@/i18n'
import type { JobSummary } from '@/lib/stats'
import { formatDateTime, formatDuration, formatNumber, formatPercent } from '@/lib/format'

type SummaryLabels = Pick<
  Dictionary['jobs'],
  'emptyWeek' | 'colJob' | 'colRuns' | 'colFailureRate' | 'colAvgTime' | 'colLastRun'
>

export function JobsSummary({
  locale,
  jobs,
  labels,
}: {
  locale: Locale
  jobs: JobSummary[]
  labels: SummaryLabels
}) {
  if (jobs.length === 0) {
    return <p className="text-xs text-ink-secondary">{labels.emptyWeek}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-hairline text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-medium">{labels.colJob}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{labels.colRuns}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{labels.colFailureRate}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{labels.colAvgTime}</th>
            <th scope="col" className="py-2 font-medium">{labels.colLastRun}</th>
          </tr>
        </thead>
        <tbody className="[font-variant-numeric:tabular-nums]">
          {jobs.map((job) => (
            <tr key={job.jobName} className="border-b border-hairline last:border-0">
              <th scope="row" className="py-2 pr-3 font-normal text-ink">{job.jobName}</th>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatNumber(locale, job.runs)}
              </td>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatPercent(locale, job.runs > 0 ? job.failed / job.runs : null)}
              </td>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatDuration(locale, job.avgDurationMs)}
              </td>
              <td className="py-2 text-ink-secondary">{formatDateTime(locale, job.lastRunAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
