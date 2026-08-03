/**
 * Shared scale arithmetic. Kept in one place: if neighboring charts drift
 * to different tick rules, they read as different units of measurement.
 */

/**
 * Y-axis labels: a "nice" step with 3-5 intervals and minimal headroom.
 * Otherwise a scale that goes to 1500 for a max of 1119 eats a quarter of
 * the chart's height for nothing.
 */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]

  const magnitude = 10 ** Math.floor(Math.log10(max))
  const candidates = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5].map((m) => m * magnitude)

  let step = magnitude
  let bestTop = Infinity
  for (const candidate of candidates) {
    const top = Math.ceil(max / candidate) * candidate
    const intervals = Math.round(top / candidate)
    if (intervals < 3 || intervals > 5) continue
    if (top < bestTop) {
      bestTop = top
      step = candidate
    }
  }

  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = 0; value <= top + step / 1000; value += step) {
    ticks.push(Math.round(value * 1000) / 1000)
  }
  return ticks
}

export type Point = { x: number; y: number }

/**
 * Smoothed line through the points: monotonic cubic interpolation
 * (Fritsch-Carlson).
 *
 * A plain spline (Catmull-Rom) doesn't work here: it overshoots past
 * neighboring values and draws a peak or dip between two points that
 * isn't in the data. For headcounts, that would mean invented spikes and
 * dips below zero. The chart would be lying.
 *
 * The monotonic scheme guarantees the curve never overshoots the values
 * on either side of a segment: the shape is smoothed, but no observation
 * is made up.
 */
export function smoothPath(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`
  }

  const n = points.length
  const dx: number[] = []
  const slope: number[] = []

  for (let i = 0; i < n - 1; i += 1) {
    const h = points[i + 1]!.x - points[i]!.x
    dx.push(h)
    slope.push(h === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / h)
  }

  // Tangents: zero where neighboring segments change direction,
  // otherwise the average of the adjacent slopes. That keeps a local
  // extremum exactly at the observed point instead of drifting between them.
  const m: number[] = [slope[0] ?? 0]
  for (let i = 1; i < n - 1; i += 1) {
    const a = slope[i - 1]!
    const b = slope[i]!
    m.push(a * b <= 0 ? 0 : (a + b) / 2)
  }
  m.push(slope[n - 2] ?? 0)

  // Fritsch-Carlson constraint: keeps the curve inside the band bounded
  // by the neighboring values.
  for (let i = 0; i < n - 1; i += 1) {
    const s = slope[i]!
    if (s === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i]! / s
    const b = m[i + 1]! / s
    const sum = a * a + b * b
    if (sum > 9) {
      const t = 3 / Math.sqrt(sum)
      m[i] = t * a * s
      m[i + 1] = t * b * s
    }
  }

  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i]! / 3
    const p0 = points[i]!
    const p1 = points[i + 1]!
    d += ` C ${p0.x + h} ${p0.y + m[i]! * h} ${p1.x - h} ${p1.y - m[i + 1]! * h} ${p1.x} ${p1.y}`
  }

  return d
}

/** Rectangle with rounded top corners and a flat base. */
export function topRoundedPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.max(0, Math.min(radius, width / 2, height))
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    'Z',
  ].join(' ')
}

/** Rectangle with a rounded right end, used for horizontal bars. */
export function endRoundedPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.max(0, Math.min(radius, height / 2, width))
  return [
    `M ${x} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height - r}`,
    `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `L ${x} ${y + height}`,
    'Z',
  ].join(' ')
}
