/**
 * Sparkline for a KPI tile: the series' shape, without axes or labels.
 *
 * The number on the tile carries the value, the sparkline only carries the
 * trend, so the scale is unlabeled and doesn't start at zero: the goal is
 * to make out the shape, not to read magnitudes off it.
 *
 * The line passes straight through days without an observation: DOU
 * publishes on weekdays, and weekends are an absence of the event, not a
 * gap in the data. Drawing zero for them would be wrong, so no points are
 * placed there, and the curve just goes from observation to observation.
 */

import { smoothPath } from './scale'

const W = 120
const H = 32
const PAD = 3

export function Sparkline({
  values,
  slot = 1,
  label,
}: {
  values: (number | null)[]
  /** Series palette slot 1..8. */
  slot?: number
  /** Screen-reader label: what this series is. */
  label: string
}) {
  // The scale is built from the same values as the line: if it counted
  // zeros, the shape would get pushed toward the bottom by days without publications.
  const known = values.filter((v): v is number => v !== null && v !== 0)
  if (known.length < 2) return null

  const min = Math.min(...known)
  const max = Math.max(...known)
  const span = max - min || 1

  const x = (index: number) =>
    values.length < 2 ? W / 2 : PAD + (index / (values.length - 1)) * (W - PAD * 2)
  const y = (value: number) => H - PAD - ((value - min) / span) * (H - PAD * 2)

  // Zero is dropped the same as a missing value, same as on the full-size
  // chart: it's a day without publications of this kind, not a drop in the metric.
  const points = values
    .map((value, index) => ({ index, value }))
    .filter((p): p is { index: number; value: number } => p.value !== null && p.value !== 0)
    .map((p) => ({ x: x(p.index), y: y(p.value) }))

  const lastIndex = values.findLastIndex((v) => v !== null && v !== 0)
  const lastValue = lastIndex >= 0 ? (values[lastIndex] ?? null) : null

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-8 w-full"
      role="img"
      aria-label={label}
    >
      <path
        d={smoothPath(points)}
        fill="none"
        stroke={`var(--series-${slot})`}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // Otherwise the viewBox's uneven scaling would stretch the line
        // horizontally and squash it vertically.
        vectorEffect="non-scaling-stroke"
      />

      {lastValue !== null && lastIndex >= 0 && (
        <circle cx={x(lastIndex)} cy={y(lastValue)} r={2} fill={`var(--series-${slot})`} />
      )}
    </svg>
  )
}
