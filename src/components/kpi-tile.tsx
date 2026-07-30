import { Fragment } from 'react'
import type { Locale } from '@/i18n'
import { formatPercent } from '@/lib/format'
import { Sparkline } from '@/components/charts/sparkline'

/*
 * Плитка KPI.
 *
 * Заливка плитки — оформление, а не данные: тинт закреплён за плиткой по
 * смыслу и не меняется от значений, иначе цвет начал бы врать о величине.
 * Число набрано пропорциональными цифрами: tabular-nums на этом кегле
 * выглядит разреженным, а выравнивать по колонке здесь нечего.
 */

export type KpiIcon = 'check' | 'cross' | 'percent' | 'stack'

const ICONS: Record<KpiIcon, React.ReactNode> = {
  check: <path d="M20 6 9 17l-5-5" />,
  cross: <path d="M18 6 6 18M6 6l12 12" />,
  percent: <path d="M19 5 5 19M6.5 6.5v.01M17.5 17.5v.01" />,
  stack: <path d="M12 3 3 8l9 5 9-5zM3 16l9 5 9-5M3 12l9 5 9-5" />,
}

export function KpiTile({
  locale,
  label,
  value,
  icon,
  tint,
  slot,
  change = null,
  betterWhenUp = true,
  comparedTo,
  unchangedLabel,
  hint,
  note,
  spark,
  sparkLabel,
}: {
  locale: Locale
  label: string
  value: string
  icon: KpiIcon
  /** Тинт заливки 1..4. */
  tint: number
  /** Слот палитры серий для иконки и спарклайна. */
  slot: number
  change?: number | null
  betterWhenUp?: boolean
  comparedTo: string
  unchangedLabel: string
  hint?: string
  /**
   * Из чего складывается значение — по одной части на слагаемое.
   * Списком, а не готовой строкой: на узкой плитке строка переносится,
   * и подпись обязана оставаться на одной строке со своим числом.
   */
  note?: string[]
  spark?: (number | null)[]
  sparkLabel?: string
}) {
  return (
    <div
      className="rounded-2xl p-4 sm:p-5"
      style={{ backgroundColor: `var(--tint-${tint})` }}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface"
          style={{ color: `var(--series-${slot})` }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-5"
            aria-hidden="true"
          >
            {ICONS[icon]}
          </svg>
        </span>

        {spark && sparkLabel && (
          <span className="min-w-0 flex-1 pt-1">
            <Sparkline values={spark} slot={slot} label={sparkLabel} />
          </span>
        )}
      </div>

      <div className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{value}</div>
      <div className="mt-0.5 text-xs text-ink-secondary">{label}</div>

      <div className="mt-2 min-h-4 text-xs">
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

      {note && note.length > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          {note.map((part, index) => (
            <Fragment key={part}>
              {index > 0 && ' · '}
              <span className="whitespace-nowrap">{part}</span>
            </Fragment>
          ))}
        </p>
      )}
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
  comparedTo: string
  unchangedLabel: string
}) {
  const flat = Math.abs(change) < 0.005
  const up = change > 0
  const good = betterWhenUp ? up : !up

  const color = flat ? 'text-ink-muted' : good ? 'text-delta-good' : 'text-critical'

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className={color}>
        {/* Стрелка продублирована текстом: направление не должно
            держаться на одном цвете. */}
        <span aria-hidden="true">{flat ? '→' : up ? '↑' : '↓'}</span>{' '}
        {flat ? unchangedLabel : formatPercent(locale, Math.abs(change), 0)}
      </span>
      <span className="text-ink-muted">{comparedTo}</span>
    </span>
  )
}
