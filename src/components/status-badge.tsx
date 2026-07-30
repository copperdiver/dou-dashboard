import type { JobStatus } from '@/db/schema'
import type { Dictionary } from '@/i18n'

const MARK: Record<JobStatus, { icon: string; color: string }> = {
  success: { icon: '✓', color: 'text-good' },
  failed: { icon: '✕', color: 'text-critical' },
  running: { icon: '●', color: 'text-warning' },
}

type StatusLabels = Pick<Dictionary['jobs'], 'statusSuccess' | 'statusFailed' | 'statusRunning'>

const LABEL_KEY: Record<JobStatus, keyof StatusLabels> = {
  success: 'statusSuccess',
  failed: 'statusFailed',
  running: 'statusRunning',
}

/**
 * Статус всегда «иконка + подпись»: цвет один смысл не несёт — часть
 * статусных оттенков не проходит контраст 3:1 на светлой поверхности.
 */
export function StatusBadge({ status, labels }: { status: JobStatus; labels: StatusLabels }) {
  const { icon, color } = MARK[status]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`${color} text-[10px] leading-none`} aria-hidden="true">
        {icon}
      </span>
      <span className="text-ink-secondary">{labels[LABEL_KEY[status]]}</span>
    </span>
  )
}
