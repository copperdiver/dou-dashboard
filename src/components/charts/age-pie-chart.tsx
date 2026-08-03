'use client'

import { useState } from 'react'
import type { Locale } from '@/i18n'
import { formatNumber, formatPercent } from '@/lib/format'

/**
 * Age of naturalized applicants: a donut chart.
 *
 * The donut was chosen deliberately by the client. The form has a cost:
 * groups are ordered by age ascending, but a circle doesn't show order, and
 * sectors close in size can't be compared by eye. That's why a legend with
 * values and shares, plus a table, are mandatory here, and it's not
 * decoration, it's compensation: three palette slots fail 3:1 contrast in
 * the light theme, so color can't carry meaning on its own.
 *
 * A surface-colored gap is left between sectors: without it, neighboring
 * arcs merge into one under color blindness.
 *
 * A sector and its legend row highlight together, in both directions:
 * connecting them by color alone gets harder the closer the sectors are in
 * size, and three palette slots in the light theme also fail contrast.
 * The highlight responds to both hover and keyboard focus.
 */

export type AgeSlice = {
  bucket: string
  label: string
  approvals: number
}

const SIZE = 200
const RADIUS = 70
const THICKNESS = 30
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** Gap between sectors, in arc-length units. */
const GAP = 3

export function AgePieChart({
  locale,
  slices,
  excluded,
  excludedLabel,
  totalLabel,
  showTableLabel,
  bucketLabel,
  countLabel,
  shareLabel,
  emptyLabel,
}: {
  locale: Locale
  slices: AgeSlice[]
  excluded: number
  excludedLabel: string
  totalLabel: string
  showTableLabel: string
  bucketLabel: string
  countLabel: string
  shareLabel: string
  emptyLabel: string
}) {
  const [active, setActive] = useState<string | null>(null)

  const shown = slices.filter((s) => s.approvals > 0)
  const total = shown.reduce((sum, s) => sum + s.approvals, 0)

  if (total === 0) {
    return <p className="text-xs text-ink-secondary">{emptyLabel}</p>
  }

  const lengths = shown.map((slice) => (slice.approvals / total) * CIRCUMFERENCE)

  const arcs = shown.map((slice, index) => ({
    ...slice,
    slot: index + 1,
    share: slice.approvals / total,
    // The gap eats into the end of the arc; for very narrow sectors it's
    // capped, otherwise the sector would disappear entirely.
    dash: Math.max((lengths[index] ?? 0) - GAP, 0.5),
    // There are seven groups, so a recomputed prefix sum is cheaper than an
    // accumulator and avoids introducing mutable state inside render.
    offset: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }))

  const activeArc = arcs.find((arc) => arc.bucket === active) ?? null

  return (
    <div>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-40 w-40 shrink-0 sm:h-48 sm:w-48"
          role="img"
          aria-label={`${totalLabel}: ${formatNumber(locale, total)}`}
        >
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {arcs.map((arc) => {
              const dimmed = active !== null && active !== arc.bucket

              return (
                <circle
                  key={arc.bucket}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={`var(--series-${arc.slot})`}
                  // The active sector is slightly thicker, the rest are dimmed:
                  // thickness still works where color is hard to tell apart.
                  strokeWidth={active === arc.bucket ? THICKNESS + 6 : THICKNESS}
                  strokeOpacity={dimmed ? 0.35 : 1}
                  strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
                  strokeDashoffset={-arc.offset}
                  className="cursor-pointer"
                  onMouseEnter={() => setActive(arc.bucket)}
                  onMouseLeave={() => setActive(null)}
                  onPointerDown={() => setActive(arc.bucket)}
                />
              )
            })}
          </g>
          {/* The center shows the total, and on hover the selected group's
              value: this way the number doesn't need to be hunted down in the legend. */}
          <text
            x={SIZE / 2}
            y={SIZE / 2 - 2}
            textAnchor="middle"
            className="fill-ink text-[22px] font-semibold"
          >
            {formatNumber(locale, activeArc ? activeArc.approvals : total)}
          </text>
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 16}
            textAnchor="middle"
            className="fill-ink-muted text-[10px]"
          >
            {activeArc ? activeArc.label : totalLabel}
          </text>
        </svg>

        {/* Legend with values, not just names: magnitudes can't be read
            off the ring itself. */}
        <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-1">
          {arcs.map((arc) => {
            const on = active === arc.bucket

            return (
              <li key={arc.bucket}>
                {/* A button, not just a row: the highlight must work from
                    the keyboard too, not just under the cursor. */}
                <button
                  type="button"
                  onMouseEnter={() => setActive(arc.bucket)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(arc.bucket)}
                  onBlur={() => setActive(null)}
                  aria-current={on ? 'true' : undefined}
                  className={
                    'flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left ' +
                    (on ? 'bg-page' : '')
                  }
                >
                  <span
                    className="size-2.5 shrink-0 translate-y-px rounded-[2px]"
                    style={{ backgroundColor: `var(--series-${arc.slot})` }}
                    aria-hidden="true"
                  />
                  <span className={on ? 'font-medium text-ink' : 'text-ink-secondary'}>
                    {arc.label}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-ink">
                    {formatNumber(locale, arc.approvals)}
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-ink-muted">
                    {formatPercent(locale, arc.share, 0)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {excluded > 0 && <p className="mt-4 text-xs text-ink-muted">{excludedLabel}</p>}

      <details className="mt-3 text-xs text-ink-secondary">
        <summary className="cursor-pointer select-none hover:text-ink">{showTableLabel}</summary>
        <div className="mt-2 overflow-hidden rounded-lg border border-hairline">
          <table className="w-full border-collapse text-left [font-variant-numeric:tabular-nums]">
            <thead className="bg-surface">
              <tr className="border-b border-hairline text-ink-muted">
                <th scope="col" className="px-3 py-2 font-medium">{bucketLabel}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{countLabel}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{shareLabel}</th>
              </tr>
            </thead>
            <tbody>
              {arcs.map((arc) => (
                <tr key={arc.bucket} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-3 py-1.5 font-normal text-ink-secondary">
                    {arc.label}
                  </th>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {formatNumber(locale, arc.approvals)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {formatPercent(locale, arc.share, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
