const numberFormat = new Intl.NumberFormat('ru-RU')
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

/** 1284 → «1 284», 12 900 → «12,9 тыс.», 4 200 000 → «4,2 млн». */
export function formatCompact(value: number): string {
  if (Math.abs(value) < 10_000) return numberFormat.format(value)
  if (Math.abs(value) < 1_000_000) return `${numberFormat.format(round(value / 1000, 1))} тыс.`
  return `${numberFormat.format(round(value / 1_000_000, 1))} млн`
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return '—'
  return `${numberFormat.format(round(value * 100, digits))} %`
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  if (ms < 60_000) return `${numberFormat.format(round(ms / 1000, 1))} с`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes} мин ${seconds} с`
}

export function formatDateTime(value: Date | string | null): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return dateTimeFormat.format(date)
}

/** Относительное изменение к предыдущему периоду, 0..∞. null — если сравнивать не с чем. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return (current - previous) / previous
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
