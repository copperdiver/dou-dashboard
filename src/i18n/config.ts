/**
 * Локали приложения.
 *
 * Библиотека i18n сознательно не используется. Единственное, что здесь
 * действительно трудно, — русские формы числительных («1 отказ,
 * 2 отказа, 5 отказов»), и их корректно решает встроенный
 * `Intl.PluralRules`. Остальное — плоский типизированный словарь,
 * который проверяет компилятор.
 */

export const LOCALES = ['ru', 'en'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'ru'

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/** Подписи переключателя — на своём же языке, а не в переводе. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
}

/**
 * Локаль для Intl. Для дат и чисел нужен полный тег, иначе `ru`
 * форматируется по умолчаниям, а не по российским.
 */
export const INTL_LOCALES: Record<Locale, string> = {
  ru: 'ru-RU',
  en: 'en-US',
}
