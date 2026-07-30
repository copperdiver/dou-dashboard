/**
 * Написания стран, встречающиеся в DOU и не совпадающие с названиями
 * ISO-3166 из countries.generated.ts.
 *
 * Список собран замером: на 66 наблюдавшихся названий не разрешилось 9.
 * Пополняется по отчёту «неопознанные страны» на экране health — там
 * видно `country_raw` без `country_id`.
 *
 * Ключ хранится уже нормализованным (normalizeCountryName), поэтому
 * регистр и диакритика здесь не важны — записаны как в источнике
 * только для читаемости.
 */
export type CountryAliasSeed = {
  alias: string
  iso2: string
  isAmbiguous?: boolean
  note?: string
}

export const COUNTRY_ALIAS_SEED: readonly CountryAliasSeed[] = [
  { alias: 'Belarus', iso2: 'BY', note: 'в ISO-3166 pt — Bielorrússia' },
  { alias: 'Benin', iso2: 'BJ', note: 'в ISO-3166 pt — Benim' },
  {
    alias: 'Congo',
    iso2: 'CG',
    isAmbiguous: true,
    note: 'DOU не различает Республику Конго (CG) и ДР Конго (CD); сопоставлено с CG по названию, требует ручной проверки',
  },
  { alias: 'Coréia do Sul', iso2: 'KR', note: 'орфография до реформы; в ISO — Coreia do Sul' },
  { alias: 'Estado da Palestina', iso2: 'PS', note: 'в ISO — Palestina' },
  { alias: 'Guiná-Bissau', iso2: 'GW', note: 'опечатка источника вместо Guiné-Bissau' },
  { alias: 'Irã', iso2: 'IR', note: 'в ISO-3166 pt — Irão' },
  { alias: 'Iêmen', iso2: 'YE', note: 'в ISO-3166 pt — Iémen' },
  { alias: 'Kuwait', iso2: 'KW', note: 'в ISO-3166 pt — Koweit' },
] as const
