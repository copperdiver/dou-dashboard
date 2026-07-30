import type { JobRun } from '@/db/schema'
import { StatusBadge } from '@/components/status-badge'
import { formatDateTime, formatDuration, formatNumber } from '@/lib/format'

export function RecentRuns({ runs }: { runs: JobRun[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-xs text-ink-secondary">
        Запусков пока нет. Поднимите воркер (<code className="text-ink">npm run worker</code> или
        сервис <code className="text-ink">worker</code> в docker compose).
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-hairline text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Задача</th>
            <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
            <th scope="col" className="py-2 pr-3 font-medium">Начало</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Длительность</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Обработано</th>
            <th scope="col" className="py-2 font-medium">Ошибка</th>
          </tr>
        </thead>
        <tbody className="[font-variant-numeric:tabular-nums]">
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-hairline last:border-0">
              <th scope="row" className="py-2 pr-3 font-normal text-ink">
                {run.jobName}
                {run.attempt > 1 && (
                  <span className="ml-1 text-ink-muted">попытка {run.attempt}</span>
                )}
              </th>
              <td className="py-2 pr-3">
                <StatusBadge status={run.status} />
              </td>
              <td className="py-2 pr-3 text-ink-secondary">{formatDateTime(run.startedAt)}</td>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatDuration(run.durationMs)}
              </td>
              <td className="py-2 pr-3 text-right text-ink-secondary">
                {formatNumber(run.itemsProcessed)}
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
