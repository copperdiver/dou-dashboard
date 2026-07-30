/**
 * Генератор справочника стран: ISO-3166 плюс названия на pt/en/ru.
 *
 *   npx tsx scripts/generate-countries.ts
 *
 * Результат коммитится (`src/db/seeds/countries.generated.ts`), поэтому
 * i18n-iso-countries нужен только разработчику и не попадает в образ воркера.
 * Перезапускать при обновлении пакета.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import countries from 'i18n-iso-countries'
import en from 'i18n-iso-countries/langs/en.json' with { type: 'json' }
import pt from 'i18n-iso-countries/langs/pt.json' with { type: 'json' }
import ru from 'i18n-iso-countries/langs/ru.json' with { type: 'json' }

countries.registerLocale(en)
countries.registerLocale(pt)
countries.registerLocale(ru)

const out = fileURLToPath(new URL('../src/db/seeds/countries.generated.ts', import.meta.url))

type Row = { iso2: string; iso3: string | null; namePt: string; nameEn: string; nameRu: string }

const rows: Row[] = []
const skipped: string[] = []

for (const iso2 of Object.keys(countries.getAlpha2Codes()).sort()) {
  const namePt = countries.getName(iso2, 'pt')
  const nameEn = countries.getName(iso2, 'en')
  const nameRu = countries.getName(iso2, 'ru')

  // Без португальского названия строка бесполезна: сопоставление идёт по нему.
  if (!namePt || !nameEn) {
    skipped.push(iso2)
    continue
  }

  rows.push({
    iso2,
    iso3: countries.alpha2ToAlpha3(iso2) ?? null,
    namePt,
    nameEn,
    // Русского названия может не быть — тогда показываем английское.
    nameRu: nameRu || nameEn,
  })
}

const body = `/* Сгенерировано scripts/generate-countries.ts — не править руками. */

export type CountrySeed = {
  iso2: string
  iso3: string | null
  namePt: string
  nameEn: string
  nameRu: string
}

export const COUNTRY_SEED: readonly CountrySeed[] = ${JSON.stringify(rows, null, 2)} as const
`

writeFileSync(out, body, 'utf8')
console.log(`[countries] записано ${rows.length} стран в ${out}`)
if (skipped.length) console.log(`[countries] пропущено без названия: ${skipped.join(', ')}`)
