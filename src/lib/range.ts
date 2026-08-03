/**
 * Observation period. Lives in the page URL rather than component state:
 * this way the view can be shared as a link, works without JS, and
 * survives a reload.
 *
 * Dates here are calendar strings `YYYY-MM-DD`, with no time or zone.
 * A DOU edition day is a Brazilian calendar day; converting it to a
 * point in time would shift it by a day in any zone with a negative offset.
 */

export const RANGE_PRESETS = ['7d', '30d', '90d', 'mtd', 'all'] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]

export const DEFAULT_PRESET: RangePreset = '90d'

export type ResolvedRange = {
  from: string
  to: string
  /** `custom` means the bounds were set manually and don't match any preset. */
  preset: RangePreset | 'custom'
}

export type DataBounds = { min: string; max: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === value
}

/** UTC date as `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return toIsoDate(date)
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime()
  const b = new Date(`${to}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** Today's date in the process's time zone (TZ from .env), not UTC. */
export function today(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function presetRange(preset: RangePreset, anchor: string, bounds: DataBounds): ResolvedRange {
  switch (preset) {
    case '7d':
      return { from: addDays(anchor, -6), to: anchor, preset }
    case '30d':
      return { from: addDays(anchor, -29), to: anchor, preset }
    case '90d':
      return { from: addDays(anchor, -89), to: anchor, preset }
    case 'mtd':
      return { from: `${anchor.slice(0, 7)}-01`, to: anchor, preset }
    case 'all':
      return { from: bounds.min, to: bounds.max, preset }
  }
}

/**
 * Parses the period from the URL.
 *
 * Presets are counted from today, not from the last day with data: if
 * the pipeline has fallen behind, "last 30 days" must show that as a
 * gap at the tail of the chart, not silently shift the window to the
 * latest data.
 */
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  bounds: DataBounds,
): ResolvedRange {
  const anchor = today()

  if (isIsoDate(params.from) && isIsoDate(params.to) && params.from <= params.to) {
    return { from: params.from, to: params.to, preset: 'custom' }
  }

  const preset = (RANGE_PRESETS as readonly string[]).includes(params.range ?? '')
    ? (params.range as RangePreset)
    : DEFAULT_PRESET

  return presetRange(preset, anchor, bounds)
}

/** URL parameters for a link to the period. */
export function rangeParams(range: ResolvedRange): Record<string, string> {
  return range.preset === 'custom'
    ? { from: range.from, to: range.to }
    : { range: range.preset }
}
