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
 * Status is always "icon + label": color alone doesn't carry the meaning.
 * Some of the status shades don't clear 3:1 contrast on a light surface.
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
