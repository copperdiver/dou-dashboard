import { formatPercent } from '@/lib/format'

type StatTileProps = {
  label: string
  value: string
  /** Относительное изменение к предыдущему периоду, 0..∞. null — скрыть. */
  change?: number | null
  /** Рост — это хорошо? Для «Ошибок» — нет. */
  betterWhenUp?: boolean
  /** С каким периодом сравниваем, например «пред. 24 ч». */
  comparedTo?: string
  hint?: string
}

export function StatTile({
  label,
  value,
  change = null,
  betterWhenUp = true,
  comparedTo = 'пред. 24 ч',
  hint,
}: StatTileProps) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1.5 min-h-4 text-xs">
        {change === null ? (
          hint ? <span className="text-ink-muted">{hint}</span> : null
        ) : (
          <Delta change={change} betterWhenUp={betterWhenUp} comparedTo={comparedTo} />
        )}
      </div>
    </div>
  )
}

function Delta({
  change,
  betterWhenUp,
  comparedTo,
}: {
  change: number
  betterWhenUp: boolean
  comparedTo: string
}) {
  const flat = Math.abs(change) < 0.005
  const up = change > 0
  const good = betterWhenUp ? up : !up

  const color = flat
    ? 'text-ink-muted'
    : good
      ? 'text-delta-good'
      : 'text-critical'

  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={color}>
        <span aria-hidden="true">{flat ? '→' : up ? '↑' : '↓'}</span>{' '}
        {flat ? 'без изменений' : formatPercent(Math.abs(change), 0)}
      </span>
      <span className="text-ink-muted">к {comparedTo}</span>
    </span>
  )
}
