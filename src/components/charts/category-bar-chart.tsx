import Link from 'next/link'
import type { Locale } from '@/i18n'
import { formatNumber, formatPercent } from '@/lib/format'

/**
 * Denial reason categories: horizontal bars.
 *
 * Plain markup, not SVG: category names are long, they need word wrapping
 * and a stretching width, and text inside SVG can do neither.
 *
 * The color comes from the category's `color_slot`, not from its position
 * in the list: the order changes with the period, and a color tied to rank
 * would repaint the categories on every switch.
 *
 * The value is labeled on every bar. This is a hard requirement: three
 * palette slots fall short of 3:1 contrast in the light theme, so color
 * can't be the sole carrier of meaning.
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
   * Denials with an identified reason: the share is computed against
   * these, not against all denials and not against the sum of the bars.
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
  /** How many denials are still reasonless. undefined means there are none. */
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
                {/* The track establishes the scale's length: without it,
                    bars read as shares of different wholes. */}
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
