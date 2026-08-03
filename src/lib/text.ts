import { createHash } from 'node:crypto'

/**
 * Text primitives shared by the parser, reason canonicalization, and seeds.
 *
 * Normalization is done here, in the application, rather than as an
 * index expression: unaccent() in Postgres is declared STABLE, so an
 * index on unaccent(name) can't be created. That means normalized
 * values have to be materialized columns, and this file is the single
 * source of truth for normalization rules.
 */

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Strips diacritics: `Colômbia` → `Colombia`. */
export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Mn}+/gu, '')
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Key for search and reference-data matching: no diacritics,
 * lowercase, single spaces.
 */
export function normalizeKey(value: string): string {
  return collapseWhitespace(stripDiacritics(value).toLowerCase())
}

/**
 * A person's name as a display value: strips trailing punctuation (the
 * source has cases like `LOUTFIA CHARIF SAID ALI.`) and extra spaces,
 * but keeps diacritics and case.
 */
export function cleanPersonName(value: string): string {
  return collapseWhitespace(value).replace(/[.,;:\s]+$/, '')
}

/** Search key for a person's name. Additionally strips punctuation. */
export function normalizeName(value: string): string {
  return collapseWhitespace(
    stripDiacritics(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' '),
  )
}

/*
 * Normalization of denial reason text lives in
 * src/lib/reasons/normalize.ts (`reasonDedupKey`): it's needed there
 * together with offset tracking for evidence spans, and two
 * implementations would inevitably diverge.
 */

/**
 * Preposition before a country name in DOU: `natural da Colômbia`,
 * `natural do Haiti`, `natural de Marrocos`, `natural dos Estados Unidos`.
 * Observed frequencies: da(234) / do(219) / de(58) / dos(4).
 */
const COUNTRY_PREPOSITION = /^(?:d[aeo]s?|d')\s+/i

export function normalizeCountryName(value: string): string {
  return normalizeKey(value.replace(COUNTRY_PREPOSITION, ''))
}

/**
 * Process number. The source has two coexisting formats, measured
 * across 17 pages: `235881.0744976/2026` (719 occurrences) and the
 * standard NUP `08000.038208/2025-70` (597). Plus variants with a
 * `Naturalizar-se nº ...` prefix and a trailing period.
 *
 * Check order matters: NUP is longer and is checked first, otherwise
 * the shorter pattern would chop off its check digits.
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

/** Full age as of the publication date. */
export function ageOn(birthDate: string, onDate: string): number | null {
  const birth = new Date(`${birthDate}T00:00:00Z`)
  const on = new Date(`${onDate}T00:00:00Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(on.getTime())) return null

  let age = on.getUTCFullYear() - birth.getUTCFullYear()
  const monthDelta = on.getUTCMonth() - birth.getUTCMonth()
  if (monthDelta < 0 || (monthDelta === 0 && on.getUTCDate() < birth.getUTCDate())) age -= 1

  return age >= 0 && age < 130 ? age : null
}

/*
 * Age buckets are deliberately absent here. The boundaries are defined
 * once, in the mart pump's SQL (src/worker/pumps/rollup.ts,
 * AGE_BUCKET_SQL) plus the enum of values in `age_bucket` in the schema.
 * Duplicating them as a TypeScript function would mean keeping two
 * definitions of the same boundaries, which would inevitably diverge:
 * the UI reads ready-made buckets from the mart and has no need to
 * recompute them.
 */
