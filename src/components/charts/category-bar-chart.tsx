import Link from 'next/link'
import type { Locale } from '@/i18n'
import { formatNumber, formatPercent } from '@/lib/format'

/**
 * Категории причин отказа — горизонтальные столбики.
 *
 * Разметка обычная, не SVG: названия категорий длинные, им нужен перенос
 * по словам и тянущаяся ширина, а внутри SVG текст ни того, ни другого
 * не умеет.
 *
 * Цвет берётся из `color_slot` категории, а не из её места в списке:
 * порядок меняется вместе с периодом, и цвет, привязанный к рангу,
 * перекрашивал бы категории при каждом переключении.
 *
 * Значение подписано у каждого столбика. Это обязательное условие: три
 * слота палитры в светлой теме не дотягивают до контраста 3:1, и цвет
 * не может оставаться единственным носителем смысла.
 */

export type CategoryRow = {
  id: number
  code: string
  label: string
  colorSlot: number
  denials: number
}

export function CategoryBarChart({
  locale,
  rows,
  /**
   * Отказы с определённой причиной: доля считается от них, а не от всех
   * отказов и не от суммы столбиков.
   */
  denialsTotal,
  note,
  baseNote,
  unknownNote,
  emptyLabel,
  drilldownHref,
  drilldownLabel,
}: {
  locale: Locale
  rows: CategoryRow[]
  denialsTotal: number
  note: string
  baseNote: string
  /** Сколько отказов ещё без причины. undefined — таких нет. */
  unknownNote?: string
  emptyLabel: string
  drilldownHref: string
  drilldownLabel: string
}) {
  const shown = rows.filter((r) => r.denials > 0)

  if (shown.length === 0) {
    return <p className="text-xs text-ink-secondary">{emptyLabel}</p>
  }

  const max = Math.max(...shown.map((r) => r.denials))

  return (
    <div>
      <ul className="space-y-2.5">
        {shown.map((row) => {
          const width = (row.denials / max) * 100
          const share = denialsTotal > 0 ? row.denials / denialsTotal : null

          return (
            <li key={row.id}>
              <Link
                href={`${drilldownHref}&category=${row.code}`}
                className="group block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-series-1"
              >
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 text-ink group-hover:underline">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-ink-secondary">
                    {formatNumber(locale, row.denials)}
                    {share !== null && (
                      <span className="ml-1.5 text-ink-muted">{formatPercent(locale, share, 0)}</span>
                    )}
                  </span>
                </div>
                {/* Дорожка задаёт длину шкалы: без неё столбики читаются
                    как доли от разных целых. */}
                <div className="mt-1 h-2.5 w-full rounded-full bg-grid">
                  <div
                    className="h-2.5 rounded-full"
                    style={{
                      width: `${Math.max(width, 1.5)}%`,
                      backgroundColor: `var(--series-${row.colorSlot})`,
                    }}
                  />
                </div>
              </Link>
            </li>
          )
        })}
      </ul>

      <p className="mt-3 text-xs text-ink-muted">{note}</p>
      <p className="mt-1 text-xs text-ink-muted">
        {baseNote}
        {unknownNote && ` · ${unknownNote}`}
      </p>

      <Link
        href={drilldownHref}
        className="mt-2 inline-block text-xs font-medium text-series-1 hover:underline"
      >
        {drilldownLabel} →
      </Link>
    </div>
  )
}
