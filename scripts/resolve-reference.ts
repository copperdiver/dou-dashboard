/**
 * Проверяет, сопоставляются ли написания стран и штатов со справочниками.
 *
 *   npx tsx scripts/resolve-reference.ts countries names.json
 *   npx tsx scripts/resolve-reference.ts countries "Guiná-Bissau" "Belarus"
 *   npx tsx scripts/resolve-reference.ts states "São Paulo"
 *
 * Нужен, когда на экране health появились `country_raw` без `country_id`:
 * прогнать новые написания, увидеть неразрешённые и добавить их
 * в src/db/seeds/country-aliases.ts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { closePool, db } from '../src/db/client'
import { brStateAliases, brStates, countries, countryAliases } from '../src/db/schema'
import { normalizeCountryName, normalizeKey } from '../src/lib/text'

const [kind, ...rest] = process.argv.slice(2)

if (kind !== 'countries' && kind !== 'states') {
  console.error('Использование: resolve-reference.ts <countries|states> <файл.json | имена...>')
  process.exit(2)
}

const names: string[] =
  rest.length === 1 && existsSync(rest[0]!) ? JSON.parse(readFileSync(rest[0]!, 'utf8')) : rest

if (names.length === 0) {
  console.error('Не передано ни одного названия.')
  process.exit(2)
}

const normalize = kind === 'countries' ? normalizeCountryName : normalizeKey

try {
  const keys = [...new Set(names.map(normalize))]

  const resolved =
    kind === 'countries'
      ? await db
          .select({ key: countryAliases.aliasNorm, label: countries.nameRu, iso2: countries.iso2 })
          .from(countryAliases)
          .innerJoin(countries, eq(countryAliases.countryId, countries.id))
          .where(inArray(countryAliases.aliasNorm, keys))
      : await db
          .select({ key: brStateAliases.aliasNorm, label: brStates.nameRu, iso2: brStates.uf })
          .from(brStateAliases)
          .innerJoin(brStates, eq(brStateAliases.stateId, brStates.id))
          .where(inArray(brStateAliases.aliasNorm, keys))

  const byKey = new Map(resolved.map((r) => [r.key, r]))
  const missing = names.filter((n) => !byKey.has(normalize(n)))

  console.log(`Проверено: ${names.length}, разрешилось: ${names.length - missing.length}`)

  if (missing.length > 0) {
    console.log(`\nНе разрешилось (${missing.length}) — добавьте алиасы в сид:`)
    for (const n of missing) console.log(`  ${n}   → нормализованный ключ: ${normalize(n)}`)
    process.exitCode = 1
  }
} catch (error) {
  console.error('Ошибка:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
