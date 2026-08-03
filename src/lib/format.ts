import { INTL_LOCALES, type Locale } from '../i18n/config'

/**
 * Formatting of numbers, dates, and durations by locale.
 *
 * Locale is passed as a parameter rather than read from the
 * environment: pages are rendered on the server for both locales at
 * once, and global state here would leak the language between requests.
 *
 * Formatters are cached: `new Intl.NumberFormat` on every call is
 * noticeably expensive, and the feed makes thousands of calls.
 */

const numberFormats = new Map<string, Intl.NumberFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()

function numberFormat(locale: Locale, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(INTL_LOCALES[locale], options)
    numberFormats.set(key, format)
  }
  return format
}

function dateFormat(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`
  let format = dateFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_LOCALES[locale], options)
    dateFormats.set(key, format)
  }
  return format
}

export function formatNumber(locale: Locale, value: number): string {
  return numberFormat(locale).format(value)
}

/** 1284 → "1,284", 12,900 → "12.9K". Compact notation comes from Intl. */
export function formatCompact(locale: Locale, value: number): string {
  if (Math.abs(value) < 10_000) return formatNumber(locale, value)
  return numberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function formatPercent(locale: Locale, value: number | null, digits = 1): string {
  if (value === null) return '—'
  return numberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatDuration(locale: Locale, ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) {
    return numberFormat(locale, {
      style: 'unit',
      unit: 'millisecond',
      unitDisplay: 'narrow',
      maximumFractionDigits: 0,
    }).format(ms)
  }
  if (ms < 60_000) {
    return numberFormat(locale, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
      maximumFractionDigits: 1,
    }).format(ms / 1000)
  }
  return numberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'narrow',
    maximumFractionDigits: 1,
  }).format(ms / 60_000)
}

/**
 * DOU edition date. Comes in as a `YYYY-MM-DD` string and stays a date
 * with no time: applying a time zone to it would shift the day.
 * Hence `timeZone: 'UTC'`: otherwise, in negative offsets, the date
 * would shift back a day.
 */
export function formatEditionDate(locale: Locale, day: string | null): string {
  if (!day) return '—'
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return dateFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** Short axis label: "29.07" / "Jul 29". */
export function formatDayShort(locale: Locale, day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  return dateFormat(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(date)
}

/** A point in time (e.g. a job run), already with a time zone. */
export function formatDateTime(locale: Locale, value: Date | string | null): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return dateFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Relative change vs. the previous period. null means nothing to compare against. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return (current - previous) / previous
}
