import { INTL_LOCALES, type Locale } from './config'
import { getDictionary, type Dictionary, type Plural } from './dictionaries'

export { DEFAULT_LOCALE, isLocale, LOCALE_LABELS, LOCALES, type Locale } from './config'
export { getDictionary, type Dictionary } from './dictionaries'

/*
 * Функции `t('some.key')` здесь нет намеренно. Словарь передаётся как
 * объект и читается через точку (`d.kpi.approvals30d`): опечатка в ключе
 * тогда — ошибка компиляции, а не пустая строка в интерфейсе, и не нужен
 * разбор пути на каждом обращении.
 */

/**
 * Форма числительного по правилам языка.
 *
 * `Intl.PluralRules` возвращает категорию CLDR: для русского one/few/many,
 * для английского one/other. Считать формы самому нельзя — правило для
 * русского нетривиально (21 → «отказ», 22 → «отказа», 25 → «отказов»),
 * и почти любая ручная реализация ошибается на числах вида 111.
 */
export function plural(locale: Locale, count: number, forms: Plural): string {
  const category = new Intl.PluralRules(INTL_LOCALES[locale]).select(count)

  switch (category) {
    case 'one':
      return forms.one
    case 'few':
      return forms.few ?? forms.other
    case 'many':
      return forms.many ?? forms.other
    default:
      return forms.other
  }
}

/** «5 отказов» / «5 denials». */
export function formatCount(locale: Locale, count: number, forms: Plural): string {
  return `${new Intl.NumberFormat(INTL_LOCALES[locale]).format(count)} ${plural(locale, count, forms)}`
}

/** Подстановка `{name}` в строку словаря. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}

export type Translator = {
  locale: Locale
  d: Dictionary
  count: (count: number, forms: Plural) => string
  fill: (template: string, values: Record<string, string | number>) => string
}

/** Всё, что нужно серверному компоненту для вывода текста. */
export function getTranslator(locale: Locale): Translator {
  return {
    locale,
    d: getDictionary(locale),
    count: (count, forms) => formatCount(locale, count, forms),
    fill: interpolate,
  }
}
