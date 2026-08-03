import { INTL_LOCALES, type Locale } from './config'
import { getDictionary, type Dictionary, type Plural } from './dictionaries'

export { DEFAULT_LOCALE, isLocale, LOCALE_LABELS, LOCALES, type Locale } from './config'
export { getDictionary, type Dictionary } from './dictionaries'

/*
 * There's no `t('some.key')` function here, on purpose. The dictionary
 * is passed as an object and read via dot notation (`d.kpi.approvals30d`):
 * a typo in the key then becomes a compile error instead of a blank
 * string in the UI, and there's no need to parse a path on every access.
 */

/**
 * Plural form of a numeral, per the language's rules.
 *
 * `Intl.PluralRules` returns a CLDR category: one/few/many for Russian,
 * one/other for English. Computing the forms by hand isn't an option:
 * the Russian rule is nontrivial (21 → "otkaz", 22 → "otkaza",
 * 25 → "otkazov"), and almost every handwritten implementation gets
 * numbers like 111 wrong.
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

/** "5 otkazov" (ru) / "5 denials" (en). */
export function formatCount(locale: Locale, count: number, forms: Plural): string {
  return `${new Intl.NumberFormat(INTL_LOCALES[locale]).format(count)} ${plural(locale, count, forms)}`
}

/** Substitutes `{name}` placeholders into a dictionary string. */
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

/** Everything a server component needs to render text. */
export function getTranslator(locale: Locale): Translator {
  return {
    locale,
    d: getDictionary(locale),
    count: (count, forms) => formatCount(locale, count, forms),
    fill: interpolate,
  }
}
