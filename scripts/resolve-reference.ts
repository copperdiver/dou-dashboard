/**
 * Checks whether country and state spellings resolve against the reference
 * tables.
 *
 *   npx tsx scripts/resolve-reference.ts countries names.json
 *   npx tsx scripts/resolve-reference.ts countries "Guiná-Bissau" "Belarus"
 *   npx tsx scripts/resolve-reference.ts states "São Paulo"
 *
 * Needed when the health screen shows `country_raw` without `country_id`:
 * run the new spellings, see which don't resolve, and add them to
 * src/db/seeds/country-aliases.ts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { closePool, db } from '../src/db/client'
import { brStateAliases, brStates, countries, countryAliases } from '../src/db/schema'
import { normalizeCountryName, normalizeKey } from '../src/lib/text'

const [kind, ...rest] = process.argv.slice(2)

if (kind !== 'countries' && kind !== 'states') {
  console.error('Usage: resolve-reference.ts <countries|states> <file.json | names...>')
  process.exit(2)
}

const names: string[] =
  rest.length === 1 && existsSync(rest[0]!) ? JSON.parse(readFileSync(rest[0]!, 'utf8')) : rest

if (names.length === 0) {
  console.error('No names given.')
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

  console.log(`Checked: ${names.length}, resolved: ${names.length - missing.length}`)

  if (missing.length > 0) {
    console.log(`\nUnresolved (${missing.length}). Add aliases to the seed:`)
    for (const n of missing) console.log(`  ${n}   → normalized key: ${normalize(n)}`)
    process.exitCode = 1
  }
} catch (error) {
  console.error('Error:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
