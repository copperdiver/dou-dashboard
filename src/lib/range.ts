/**
 * Период наблюдения. Живёт в адресе страницы, а не в состоянии компонента:
 * так вид пересылается ссылкой, работает без JS и переживает перезагрузку.
 *
 * Даты здесь — календарные строки `YYYY-MM-DD`, без времени и пояса.
 * День выпуска DOU — это бразильские сутки; приводить его к моменту
 * времени значит сдвинуть на день в любом поясе с отрицательным смещением.
 */

export const RANGE_PRESETS = ['7d', '30d', '90d', 'mtd', 'all'] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]

export const DEFAULT_PRESET: RangePreset = '90d'

export type ResolvedRange = {
  from: string
  to: string
  /** `custom` — границы заданы вручную и не совпадают ни с одним пресетом. */
  preset: RangePreset | 'custom'
}

export type DataBounds = { min: string; max: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === value
}

/** Дата UTC в `YYYY-MM-DD`. */
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

/** Сегодняшняя дата в поясе процесса (TZ из .env), а не в UTC. */
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
 * Разбирает период из адреса.
 *
 * Пресеты отсчитываются от сегодняшнего дня, а не от последнего дня
 * с данными: если конвейер отстал, «последние 30 дней» обязаны показать
 * это разрывом в хвосте графика, а не молча сдвинуть окно к свежим данным.
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

/** Параметры адреса для ссылки на период. */
export function rangeParams(range: ResolvedRange): Record<string, string> {
  return range.preset === 'custom'
    ? { from: range.from, to: range.to }
    : { range: range.preset }
}
