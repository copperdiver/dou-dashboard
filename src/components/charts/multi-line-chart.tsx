'use client'

import { useState } from 'react'
import type { Locale } from '@/i18n'
import { formatDayShort, formatEditionDate, formatNumber } from '@/lib/format'
import { niceTicks, smoothPath } from './scale'

/**
 * Multiple series on one plot: denial reason categories over time.
 *
 * Each line's color is tied to its category (`color_slot`), not assigned
 * by order: toggling categories on and off must not repaint the remaining
 * ones, otherwise the chart couldn't be compared against itself over time.
 *
 * The active day's values are listed above the plot rather than in a
 * tooltip: eight lines give eight numbers, and on mobile a tooltip that
 * size would cover the whole chart.
 */

export type LineSeries = {
  code: string
  label: string
  colorSlot: number
  values: (number | null)[]
}

type Geometry = {
  w: number
  h: number
  pad: { top: number; right: number; bottom: number; left: number }
  xLabels: number
}

const NARROW: Geometry = {
  w: 360,
  h: 250,
  pad: { top: 14, right: 10, bottom: 34, left: 34 },
  xLabels: 4,
}

const WIDE: Geometry = {
  w: 1000,
  h: 380,
  pad: { top: 20, right: 16, bottom: 40, left: 52 },
  xLabels: 9,
}

export function MultiLineChart({
  locale,
  days,
  series,
  lineNote,
  gapNote,
  emptyLabel,
  showTableLabel,
  dateLabel,
}: {
  locale: Locale
  days: string[]
  series: LineSeries[]
  lineNote: string
  gapNote: string
  emptyLabel: string
  showTableLabel: string
  dateLabel: string
}) {
  const [active, setActive] = useState<number | null>(null)

  if (series.length === 0 || days.length === 0) {
    return <p className="text-xs text-ink-secondary">{emptyLabel}</p>
  }

  const hasGap = series.some((s) => s.values.some((v) => v === null))
  // Without a hover, we show the last day we know something about: the
  // range ends on today's date, whose data isn't in yet, and the reader
  // would otherwise see dashes instead of values.
  const shown = active !== null && days[active] ? active : lastKnownIndex(series, days.length)

  return (
    <div>
      <div className="mb-3 text-xs">
        <span className="font-medium text-ink">{formatEditionDate(locale, days[shown] ?? '')}</span>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <li key={s.code} className="inline-flex items-center gap-1.5">
              <span
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--series-${s.colorSlot})` }}
                aria-hidden="true"
              />
              <span className="text-ink-secondary">{s.label}</span>
              <span className="font-semibold text-ink tabular-nums">
                {s.values[shown] === null || s.values[shown] === undefined
                  ? '—'
                  : formatNumber(locale, s.values[shown])}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Plot
        geometry={NARROW}
        className="sm:hidden"
        locale={locale}
        days={days}
        series={series}
        active={active}
        onActive={setActive}
      />
      <Plot
        geometry={WIDE}
        className="hidden sm:block"
        locale={locale}
        days={days}
        series={series}
        active={active}
        onActive={setActive}
      />

      <p className="mt-2 text-xs text-ink-muted">
        {lineNote}
        {hasGap && ` · ${gapNote}`}
      </p>

      {/*
        The table isn't an "extra"; it's a mandatory substitute for color: three
        palette slots fail 3:1 contrast against the surface in the light theme, and
        the chart alone cannot be the sole carrier of the data.
      */}
      <details className="mt-3 text-xs text-ink-secondary">
        <summary className="cursor-pointer select-none hover:text-ink">{showTableLabel}</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-hairline">
          <table className="w-full border-collapse text-left [font-variant-numeric:tabular-nums]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-hairline text-ink-muted">
                <th scope="col" className="px-3 py-2 font-medium">{dateLabel}</th>
                {series.map((s) => (
                  <th key={s.code} scope="col" className="px-3 py-2 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day, index) => (
                <tr key={day} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-3 py-1.5 font-normal text-ink-secondary">
                    {formatEditionDate(locale, day)}
                  </th>
                  {series.map((s) => (
                    <td key={s.code} className="px-3 py-1.5 text-right text-ink">
                      {s.values[index] === null || s.values[index] === undefined
                        ? '—'
                        : formatNumber(locale, s.values[index])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function Plot({
  geometry,
  className,
  locale,
  days,
  series,
  active,
  onActive,
}: {
  geometry: Geometry
  className: string
  locale: Locale
  days: string[]
  series: LineSeries[]
  active: number | null
  onActive: (index: number | null) => void
}) {
  const { w, h, pad, xLabels } = geometry
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom
  const baseline = pad.top + plotH

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null)
  const ticks = niceTicks(Math.max(...all, 0))
  const top = ticks[ticks.length - 1] ?? 1

  const x = (index: number) =>
    days.length < 2 ? pad.left + plotW / 2 : pad.left + (index / (days.length - 1)) * plotW
  const y = (value: number) => baseline - (value / top) * plotH

  const labelEvery = Math.max(1, Math.ceil(days.length / xLabels))
  const band = plotW / Math.max(days.length - 1, 1)

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`h-auto w-full ${className}`}
      role="img"
      aria-label={`${series.length}`}
      onMouseLeave={() => onActive(null)}
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={pad.left}
            x2={pad.left + plotW}
            y1={y(tick)}
            y2={y(tick)}
            stroke={tick === 0 ? 'var(--axis)' : 'var(--grid)'}
            strokeWidth={1}
          />
          <text
            x={pad.left - 6}
            y={y(tick) + 3.5}
            textAnchor="end"
            className="fill-ink-muted text-[10px] [font-variant-numeric:tabular-nums]"
          >
            {formatNumber(locale, tick)}
          </text>
        </g>
      ))}

      {active !== null && days[active] && (
        <line
          x1={x(active)}
          x2={x(active)}
          y1={pad.top}
          y2={baseline}
          stroke="var(--axis)"
          strokeWidth={1}
        />
      )}

      {series.map((s) => (
        <Line key={s.code} values={s.values} slot={s.colorSlot} x={x} y={y} />
      ))}

      {days.map((day, index) =>
        (days.length - 1 - index) % labelEvery === 0 ? (
          <text
            key={day}
            x={x(index)}
            y={baseline + 16}
            // Edge labels are pinned to their own side: the last day's label
            // sits right on the plot's right boundary, and centered it would
            // have half of it running off the edge of the frame.
            textAnchor={index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'}
            className="fill-ink-muted text-[10px] [font-variant-numeric:tabular-nums]"
          >
            {formatDayShort(locale, day)}
          </text>
        ) : null,
      )}

      {days.map((day, index) => (
        <rect
          key={`hit-${day}`}
          x={x(index) - band / 2}
          y={pad.top}
          width={band}
          height={plotH}
          fill="transparent"
          onMouseEnter={() => onActive(index)}
          onPointerDown={() => onActive(index)}
        />
      ))}
    </svg>
  )
}

function lastKnownIndex(series: LineSeries[], length: number): number {
  for (let i = length - 1; i >= 0; i -= 1) {
    if (series.some((s) => s.values[i] !== null && s.values[i] !== undefined)) return i
  }
  return Math.max(length - 1, 0)
}

function Line({
  values,
  slot,
  x,
  y,
}: {
  values: (number | null)[]
  slot: number
  x: (index: number) => number
  y: (value: number) => number
}) {
  // Zero is treated the same as a missing point: a day with no denials in
  // this category is a day when this kind of decision wasn't published,
  // not a drop to zero. Exact values stay in the table below the chart.
  const points = values
    .map((value, index) => ({ index, value }))
    .filter((p): p is { index: number; value: number } => p.value !== null && p.value !== 0)
    .map((p) => ({ x: x(p.index), y: y(p.value) }))

  if (points.length === 0) return null
  if (points.length === 1) {
    return <circle cx={points[0]!.x} cy={points[0]!.y} r={2} fill={`var(--series-${slot})`} />
  }

  return (
    <path
      d={smoothPath(points)}
      fill="none"
      stroke={`var(--series-${slot})`}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}
