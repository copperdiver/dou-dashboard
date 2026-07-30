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

/**
 * Строки, которых нет в ISO-3166, но которые встречаются в поле страны
 * рождения. `ZZ` — код из зоны, зарезервированной ISO под собственные
 * значения, поэтому он не столкнётся с настоящей страной.
 *
 * `Apátrida` — лицо без гражданства: это не страна, но и не ошибка
 * разбора, поэтому оно должно перестать висеть в отчёте неопознанных.
 */
export const EXTRA_COUNTRY_SEED = [
  {
    iso2: 'ZZ',
    iso3: null,
    namePt: 'Apátrida',
    nameEn: 'Stateless',
    nameRu: 'Без гражданства',
  },
] as const

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

  // Найдено после разбора первых 454 одобрений.
  { alias: 'Russa', iso2: 'RU', note: 'прилагательная форма вместо Rússia' },
  { alias: 'Palestina', iso2: 'PS' },
  { alias: 'França Metropolitana', iso2: 'FR', note: 'метрополия Франции' },
  { alias: 'Grã-Bretanha', iso2: 'GB' },
  { alias: 'Grã-Betanha', iso2: 'GB', note: 'опечатка источника' },
  { alias: 'Apátrida', iso2: 'ZZ', note: 'лицо без гражданства, не страна' },
] as const
