import type { Locale } from '@/i18n/config'
import { formatPercent } from '@/lib/format'

type StatTileProps = {
  locale: Locale
  label: string
  value: string
  /** Относительное изменение к предыдущему периоду, 0..∞. null — скрыть. */
  change?: number | null
  /** Рост — это хорошо? Для «Ошибок» — нет. */
  betterWhenUp?: boolean
  /** С каким периодом сравниваем, например «к предыдущим 30 дням». */
  comparedTo?: string
  /** Текст под значением, когда сравнивать не с чем. */
  hint?: string
  /** Подпись «без изменений» на языке страницы. */
  unchangedLabel?: string
}

export function StatTile({
  locale,
  label,
  value,
  change = null,
  betterWhenUp = true,
  comparedTo,
  hint,
  unchangedLabel,
}: StatTileProps) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <div className="text-xs text-ink-secondary">{label}</div>
      {/* Крупное значение — пропорциональные цифры: tabular-nums на этом
          размере выглядит разреженным (см. правило про цифры). */}
      <div className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1.5 min-h-4 text-xs">
        {change === null ? (
          hint ? <span className="text-ink-muted">{hint}</span> : null
        ) : (
          <Delta
            locale={locale}
            change={change}
            betterWhenUp={betterWhenUp}
            comparedTo={comparedTo}
            unchangedLabel={unchangedLabel}
          />
        )}
      </div>
    </div>
  )
}

function Delta({
  locale,
  change,
  betterWhenUp,
  comparedTo,
  unchangedLabel,
}: {
  locale: Locale
  change: number
  betterWhenUp: boolean
  comparedTo?: string
  unchangedLabel?: string
}) {
  const flat = Math.abs(change) < 0.005
  const up = change > 0
  const good = betterWhenUp ? up : !up

  const color = flat ? 'text-ink-muted' : good ? 'text-delta-good' : 'text-critical'

  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={color}>
        <span aria-hidden="true">{flat ? '→' : up ? '↑' : '↓'}</span>{' '}
        {flat ? (unchangedLabel ?? '—') : formatPercent(locale, Math.abs(change), 0)}
      </span>
      {comparedTo && <span className="text-ink-muted">{comparedTo}</span>}
    </span>
  )
}
