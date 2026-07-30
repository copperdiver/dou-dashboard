import type { JobStatus } from '@/db/schema'

const STATUS: Record<JobStatus, { label: string; icon: string; color: string }> = {
  success: { label: 'успешно', icon: '✓', color: 'text-good' },
  failed: { label: 'ошибка', icon: '✕', color: 'text-critical' },
  running: { label: 'выполняется', icon: '●', color: 'text-warning' },
}

/**
 * Статус всегда «иконка + подпись»: цвет один смысл не несёт — часть
 * статусных оттенков не проходит контраст 3:1 на светлой поверхности.
 */
export function StatusBadge({ status }: { status: JobStatus }) {
  const { label, icon, color } = STATUS[status]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`${color} text-[10px] leading-none`} aria-hidden="true">
        {icon}
      </span>
      <span className="text-ink-secondary">{label}</span>
    </span>
  )
}
