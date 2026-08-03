/**
 * Application locales.
 *
 * No i18n library is used, deliberately. The only genuinely hard part
 * is Russian plural forms of numerals ("1 otkaz, 2 otkaza, 5 otkazov"),
 * and the built-in `Intl.PluralRules` handles that correctly. Everything
 * else is a flat, typed dictionary that the compiler checks.
 */

export const LOCALES = ['ru', 'en'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'ru'

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/** Switcher labels: shown in their own language, not translated. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
}

/**
 * Locale for Intl. Dates and numbers need the full tag, otherwise
 * `ru` formats using defaults instead of Russian conventions.
 */
export const INTL_LOCALES: Record<Locale, string> = {
  ru: 'ru-RU',
  en: 'en-US',
}
