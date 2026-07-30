import { createHash } from 'node:crypto'

/**
 * Текстовые примитивы, общие для парсера, канонизации причин и сидов.
 *
 * Нормализация делается здесь, в приложении, а не выражением в индексе:
 * unaccent() в Postgres объявлена STABLE, поэтому индекс по unaccent(name)
 * создать нельзя. Значит нормализованные значения — материализованные
 * колонки, и единственный источник правил нормализации — этот файл.
 */

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Снимает диакритику: `Colômbia` → `Colombia`. */
export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Mn}+/gu, '')
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Ключ для поиска и сопоставления справочников: без диакритики,
 * в нижнем регистре, с одиночными пробелами.
 */
export function normalizeKey(value: string): string {
  return collapseWhitespace(stripDiacritics(value).toLowerCase())
}

/**
 * Имя человека как отображаемое значение: снимает завершающую пунктуацию
 * (в источнике встречается `LOUTFIA CHARIF SAID ALI.`) и лишние пробелы,
 * но сохраняет диакритику и регистр.
 */
export function cleanPersonName(value: string): string {
  return collapseWhitespace(value).replace(/[.,;:\s]+$/, '')
}

/** Ключ поиска по имени человека. Дополнительно убирает пунктуацию. */
export function normalizeName(value: string): string {
  return collapseWhitespace(
    stripDiacritics(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' '),
  )
}

/*
 * Нормализация текста причины отказа живёт в src/lib/reasons/normalize.ts
 * (`reasonDedupKey`): там она нужна вместе с сохранением смещений для
 * спанов-доказательств, и две реализации неизбежно разошлись бы.
 */

/**
 * Предлог перед названием страны в DOU: `natural da Colômbia`,
 * `natural do Haiti`, `natural de Marrocos`, `natural dos Estados Unidos`.
 * Наблюдалось da(234) / do(219) / de(58) / dos(4).
 */
const COUNTRY_PREPOSITION = /^(?:d[aeo]s?|d')\s+/i

export function normalizeCountryName(value: string): string {
  return normalizeKey(value.replace(COUNTRY_PREPOSITION, ''))
}

/**
 * Номер процесса. В источнике сосуществуют два формата, замер на 17
 * страницах: `235881.0744976/2026` (719 вхождений) и стандартный NUP
 * `08000.038208/2025-70` (597). Плюс формы с префиксом
 * `Naturalizar-se nº ...` и с точкой на конце.
 *
 * Порядок проверки важен: NUP длиннее и проверяется первым, иначе
 * короткий шаблон отрезал бы у него контрольные цифры.
 */
const PROCESS_PATTERNS: readonly RegExp[] = [
  /\d{5}\.\d{6}\/\d{4}-\d{2}/,
  /\d{6}\.\d{7}\/\d{4}/,
]

export function normalizeProcessNumber(value: string | null | undefined): string | null {
  if (!value) return null
  for (const pattern of PROCESS_PATTERNS) {
    const match = pattern.exec(value)
    if (match) return match[0]
  }
  return null
}

/** Полный возраст на дату публикации. */
export function ageOn(birthDate: string, onDate: string): number | null {
  const birth = new Date(`${birthDate}T00:00:00Z`)
  const on = new Date(`${onDate}T00:00:00Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(on.getTime())) return null

  let age = on.getUTCFullYear() - birth.getUTCFullYear()
  const monthDelta = on.getUTCMonth() - birth.getUTCMonth()
  if (monthDelta < 0 || (monthDelta === 0 && on.getUTCDate() < birth.getUTCDate())) age -= 1

  return age >= 0 && age < 130 ? age : null
}

export const AGE_BUCKETS = ['0-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const

export type AgeBucketValue = (typeof AGE_BUCKETS)[number]

export function ageBucket(age: number): AgeBucketValue {
  if (age < 18) return '0-17'
  if (age < 25) return '18-24'
  if (age < 35) return '25-34'
  if (age < 45) return '35-44'
  if (age < 55) return '45-54'
  if (age < 65) return '55-64'
  return '65+'
}
