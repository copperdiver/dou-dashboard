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

/** Ключ поиска по имени человека. Дополнительно убирает пунктуацию. */
export function normalizeName(value: string): string {
  return collapseWhitespace(
    stripDiacritics(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' '),
  )
}

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
 * Преамбула, присутствующая почти в каждом тексте причины отказа.
 * Смысла не несёт, но забивает и похожесть, и промпт LLM.
 */
const REASON_PREAMBLE =
  /^\s*a\s+coordenadora\s+de\s+processos\s+migratorios[^,]*,\s*no\s+uso\s+da\s+competencia\s+delegada[^,]*,\s*(?:publicada\s+no\s+diario\s+oficial\s+da\s+uniao[^,]*,\s*)?/i

/**
 * Нормализация текста причины отказа: снимает диакритику и регистр,
 * маскирует цифровые серии (номера законов, статей, дат — они уходят
 * в legalRefs отдельным разбором) и срезает преамбулу.
 *
 * Маскировка цифр обязательна: 282 уникальных текста из 355 отличаются
 * в основном номерами и пробелами, а шаблонов всего 6.
 */
export function normalizeReasonText(value: string): string {
  const flattened = collapseWhitespace(stripDiacritics(value).toLowerCase())
  const withoutPreamble = flattened.replace(REASON_PREAMBLE, '')
  return collapseWhitespace(withoutPreamble.replace(/\d+/g, '#'))
}

/**
 * Номер процесса. В источнике встречаются `235881.0744976/2026`,
 * тот же номер с точкой на конце и форма с префиксом
 * `Naturalizar-se nº 235881.0744976/2026`.
 */
export function normalizeProcessNumber(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /\d{6}\.\d{7}\/\d{4}/.exec(value)
  return match ? match[0] : null
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
