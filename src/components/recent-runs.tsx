import type { JobRun } from '@/db/schema'
import { StatusBadge } from '@/components/status-badge'
import type { Dictionary, Locale } from '@/i18n'
import { interpolate } from '@/i18n'
import { formatDateTime, formatDuration, formatNumber } from '@/lib/format'

type RecentLabels = Pick<
  Dictionary['jobs'],
  | 'emptyRecent'
  | 'colJob'
  | 'colStatus'
  | 'colStartedAt'
  | 'colDuration'
  | 'colItems'
  | 'colError'
  | 'attempt'
  | 'statusSuccess'
  | 'statusFailed'
  | 'statusRunning'
>

export function RecentRuns({
  locale,
  runs,
  labels,
}: {
  locale: Locale
  runs: JobRun[]
  labels: RecentLabels
}) {
  if (runs.length === 0) {
    return <p className="text-xs text-ink-secondary">{labels.emptyRecent}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-hairline text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-medium">{labels.colJob}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{labels.colStatus}</th>
            <th scope="col" className="py-2 pr-3 font-medium">{labels.colStartedAt}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{labels.colDuration}</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">{labels.colItems}</th>
            <th scope="col" className="py-2 font-medium">{labels.colError}</th>
          </tr>
        </thead>
        <tbody className="[font-variant-numeric:tabular-nums]">
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-hairline last:border-0">
              <th scope="row" className="py-2 pr-3 font-normal text-ink">
                {run.jobName}
                {run.attempt > 1 && (
                  <span className="ml-1 text-ink-muted">
                    {interpolate(labels.attempt, { n: formatNumber(locale, run.attempt) })}
                  </span>
                )}
              </th>
              <td className="py-2 pr-3">
                <StatusBadge status={run.status} labels={labels} />
              </td>
              <td className="py-2 pr-3 text-ink-secondary">
                {formatDateTime(locale, run.startedAt)}
              </td>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatDuration(locale, run.durationMs)}
              </td>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatNumber(locale, run.itemsProcessed)}
              </td>
              <td className="max-w-[22ch] truncate py-2 text-ink-muted" title={run.error ?? ''}>
                {run.error ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
