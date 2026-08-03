'use client'

import { useState } from 'react'
import { formatDayShort, formatEditionDate, formatNumber } from '@/lib/format'
import type { Locale } from '@/i18n'
import { niceTicks, smoothPath } from './scale'

/**
 * Approvals and denials by day.
 *
 * Both series are counts of people, so there's one shared scale. A second
 * axis can't happen here: two different zeros on the same plot can produce
 * any "correlation" you want.
 *
 * The line is continuous and runs through days without an edition: DOU
 * publishes on weekdays, and on weekends there was nothing to publish:
 * an absence of the event, not an absence of knowledge. Points sit at
 * their actual calendar positions, so the length of the span across a
 * weekend shows up as a slope.
 *
 * A day that failed to load is a different matter: there we simply don't
 * know what happened. Such days are marked with a bar under the curve, so
 * the solid line doesn't pass off a gap in the data as an observation.
 */

export type SeriesPoint = {
  day: string
  approvals: number | null
  denials: number | null
  coverage: 'covered' | 'no_edition' | 'missing'
}

type Labels = {
  approvals: string
  denials: string
  lineNote: string
  gapNote: string
  showTable: string
  date: string
  total: string
  noData: string
}

/** Geometry per screen width: on mobile the plot is taller and has fewer labels. */
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
  h: 360,
  pad: { top: 20, right: 16, bottom: 40, left: 52 },
  xLabels: 9,
}

export function TimeSeriesChart({
  locale,
  data,
  labels,
}: {
  locale: Locale
  data: SeriesPoint[]
  labels: Labels
}) {
  // The active-day index is shared between both plots: only one is ever
  // visible, and the state survives a screen-width change.
  const [active, setActive] = useState<number | null>(null)

  // We only warn about days that failed to load. Weekends without an
  // edition aren't a gap in the data, and there's nothing to call out about them.
  const hasGap = data.some((p) => p.coverage === 'missing')
  const shown = active !== null && data[active] ? active : lastKnownIndex(data)
  const point = shown === null ? null : data[shown]

  return (
    <div>
      {/*
        Readouts are placed above the chart rather than in a tooltip under the
        cursor: on mobile, the finger covers exactly the point the tooltip
        would be describing.
      */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        <span className="font-medium text-ink">
          {point ? formatEditionDate(locale, point.day) : '—'}
        </span>
        <Readout
          label={labels.approvals}
          slot={1}
          value={point?.approvals ?? null}
          locale={locale}
          noData={labels.noData}
        />
        <Readout
          label={labels.denials}
          slot={2}
          value={point?.denials ?? null}
          locale={locale}
          noData={labels.noData}
        />
      </div>

      <Plot
        geometry={NARROW}
        className="sm:hidden"
        locale={locale}
        data={data}
        active={active}
        onActive={setActive}
      />
      <Plot
        geometry={WIDE}
        className="hidden sm:block"
        locale={locale}
        data={data}
        active={active}
        onActive={setActive}
      />

      <p className="mt-2 text-xs text-ink-muted">
        {labels.lineNote}
        {hasGap && ` · ${labels.gapNote}`}
      </p>

      <details className="mt-3 text-xs text-ink-secondary">
        <summary className="cursor-pointer select-none hover:text-ink">{labels.showTable}</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-hairline">
          <table className="w-full border-collapse text-left [font-variant-numeric:tabular-nums]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-hairline text-ink-muted">
                <th scope="col" className="px-3 py-2 font-medium">{labels.date}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labels.approvals}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labels.denials}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.day} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-3 py-1.5 font-normal text-ink-secondary">
                    {formatEditionDate(locale, p.day)}
                  </th>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {p.approvals === null ? '—' : formatNumber(locale, p.approvals)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {p.denials === null ? '—' : formatNumber(locale, p.denials)}
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

function Readout({
  label,
  slot,
  value,
  locale,
  noData,
}: {
  label: string
  slot: number
  value: number | null
  locale: Locale
  noData: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-0.5 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--series-${slot})` }}
        aria-hidden="true"
      />
      <span className="text-ink-secondary">{label}</span>
      <span className="font-semibold text-ink [font-variant-numeric:tabular-nums]">
        {value === null ? noData : formatNumber(locale, value)}
      </span>
    </span>
  )
}

function Plot({
  geometry,
  className,
  locale,
  data,
  active,
  onActive,
}: {
  geometry: Geometry
  className: string
  locale: Locale
  data: SeriesPoint[]
  active: number | null
  onActive: (index: number | null) => void
}) {
  const { w, h, pad, xLabels } = geometry
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom
  const baseline = pad.top + plotH

  const values = data.flatMap((p) => [p.approvals, p.denials]).filter((v): v is number => v !== null)
  const ticks = niceTicks(Math.max(...values, 0))
  const top = ticks[ticks.length - 1] ?? 1

  const x = (index: number) =>
    data.length < 2 ? pad.left + plotW / 2 : pad.left + (index / (data.length - 1)) * plotW
  const y = (value: number) => baseline - (value / top) * plotH

  const labelEvery = Math.max(1, Math.ceil(data.length / xLabels))

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`h-auto w-full ${className}`}
      role="img"
      aria-label={`${data.length}`}
      onMouseLeave={() => onActive(null)}
    >
      {ticks.map((tick) => {
        const ty = y(tick)
        return (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={pad.left + plotW}
              y1={ty}
              y2={ty}
              stroke={tick === 0 ? 'var(--axis)' : 'var(--grid)'}
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={ty + 3.5}
              textAnchor="end"
              className="fill-ink-muted text-[10px] [font-variant-numeric:tabular-nums]"
            >
              {formatNumber(locale, tick)}
            </text>
          </g>
        )
      })}

      {/* Days that failed to load: a tick at the baseline. The curve above them
          stays solid, but the bar shows that nothing was observed there. */}
      {data.map((p, index) =>
        p.coverage === 'missing' ? (
          <rect
            key={`miss-${p.day}`}
            x={x(index) - Math.max(plotW / Math.max(data.length - 1, 1) / 2, 1)}
            y={baseline - 3}
            width={Math.max(plotW / Math.max(data.length - 1, 1), 2)}
            height={3}
            fill="var(--axis)"
          />
        ) : null,
      )}

      {active !== null && data[active] && (
        <line
          x1={x(active)}
          x2={x(active)}
          y1={pad.top}
          y2={baseline}
          stroke="var(--axis)"
          strokeWidth={1}
        />
      )}

      <Line data={data} pick={(p) => p.approvals} slot={1} x={x} y={y} />
      <Line data={data} pick={(p) => p.denials} slot={2} x={x} y={y} />

      {active !== null && data[active] && (
        <>
          <Marker value={data[active].approvals} cx={x(active)} y={y} slot={1} />
          <Marker value={data[active].denials} cx={x(active)} y={y} slot={2} />
        </>
      )}

      {data.map((p, index) =>
        (data.length - 1 - index) % labelEvery === 0 ? (
          <text
            key={p.day}
            x={x(index)}
            y={baseline + 16}
            // Edge labels are pinned to their own side: the last day's label
            // sits right on the plot's right boundary, and centered it would
            // have half of it running off the edge of the frame.
            textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
            className="fill-ink-muted text-[10px] [font-variant-numeric:tabular-nums]"
          >
            {formatDayShort(locale, p.day)}
          </text>
        ) : null,
      )}

      {/* Hit zones are wider than the marker: you can't aim a finger at a
          2px-thick line. */}
      {data.map((p, index) => (
        <rect
          key={`hit-${p.day}`}
          x={x(index) - plotW / Math.max(data.length - 1, 1) / 2}
          y={pad.top}
          width={plotW / Math.max(data.length - 1, 1)}
          height={plotH}
          fill="transparent"
          onMouseEnter={() => onActive(index)}
          onPointerDown={() => onActive(index)}
        />
      ))}
    </svg>
  )
}

function Line({
  data,
  pick,
  slot,
  x,
  y,
}: {
  data: SeriesPoint[]
  pick: (p: SeriesPoint) => number | null
  slot: number
  x: (index: number) => number
  y: (value: number) => number
}) {
  /*
   * Points exist only where decisions of this kind were published.
   *
   * Zero is dropped the same as a missing value: approvals are published
   * as portarias, denials as despachos, and those are different days. Zero
   * denials on a day when no despacho was published means no publication,
   * not a decision of "zero denials", and dragging the line down to the
   * axis over it would draw a dip that doesn't exist in the domain.
   *
   * Points stay at their actual calendar positions, so the length of a
   * span shows up as a slope. Exact values, including zeros, are in the
   * table below.
   */
  const points = data
    .map((p, index) => ({ index, value: pick(p) }))
    .filter((p): p is { index: number; value: number } => p.value !== null && p.value !== 0)
    .map((p) => ({ x: x(p.index), y: y(p.value) }))

  if (points.length === 0) return null
  if (points.length === 1) {
    return <circle cx={points[0]!.x} cy={points[0]!.y} r={2.5} fill={`var(--series-${slot})`} />
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

function Marker({
  value,
  cx,
  y,
  slot,
}: {
  value: number | null
  cx: number
  y: (value: number) => number
  slot: number
}) {
  if (value === null) return null
  return (
    <circle
      cx={cx}
      cy={y(value)}
      r={4}
      fill={`var(--series-${slot})`}
      // A surface-colored ring separates the marker from the line under it.
      stroke="var(--surface-1)"
      strokeWidth={2}
    />
  )
}

function lastKnownIndex(data: SeriesPoint[]): number | null {
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const p = data[i]
    if (p && (p.approvals !== null || p.denials !== null)) return i
  }
  return null
}
