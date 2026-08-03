/**
 * Seeds reference data: countries, aliases, states, categories, and atomic
 * denial reasons.
 *
 *   npm run db:seed-reference
 *
 * Idempotent: re-running updates names and adds new rows, but doesn't
 * create duplicates and doesn't overwrite reasons that were edited
 * manually (`reasons.is_manually_edited`).
 *
 * This isn't demo data: country and state matching doesn't work without
 * this reference data, so the script is part of the regular deployment flow.
 */
import { eq, sql } from 'drizzle-orm'
import { reasonDedupKey } from '../lib/reasons/normalize'
import { normalizeCountryName, normalizeKey } from '../lib/text'
import { closePool, db } from './client'
import {
  brStateAliases,
  brStates,
  countries,
  countryAliases,
  reasonCategories,
  reasons,
} from './schema'
import { BR_STATE_ALIAS_SEED, BR_STATE_SEED } from './seeds/br-states'
import { COUNTRY_ALIAS_SEED, EXTRA_COUNTRY_SEED } from './seeds/country-aliases'
import { COUNTRY_SEED } from './seeds/countries.generated'
import { REASON_CATEGORY_SEED } from './seeds/reason-categories'
import { REASON_SEED } from './seeds/reasons'

async function seedCountries(): Promise<Map<string, number>> {
  await db
    .insert(countries)
    .values(
      [...COUNTRY_SEED, ...EXTRA_COUNTRY_SEED].map((c) => ({
        iso2: c.iso2,
        iso3: c.iso3,
        namePt: c.namePt,
        nameEn: c.nameEn,
        nameRu: c.nameRu,
      })),
    )
    .onConflictDoUpdate({
      target: countries.iso2,
      set: {
        iso3: sql`excluded.iso3`,
        namePt: sql`excluded.name_pt`,
        nameEn: sql`excluded.name_en`,
        nameRu: sql`excluded.name_ru`,
      },
    })

  const rows = await db.select({ id: countries.id, iso2: countries.iso2 }).from(countries)
  const byIso2 = new Map(rows.map((r) => [r.iso2, r.id]))
  console.log(`[seed] countries: ${rows.length}`)

  // The ISO name is itself an alias: matching happens by normalized
  // key, not by exact string match.
  const aliases = new Map<string, { countryId: number; isAmbiguous: boolean; note: string | null }>()

  for (const c of [...COUNTRY_SEED, ...EXTRA_COUNTRY_SEED]) {
    const id = byIso2.get(c.iso2)
    if (id === undefined) continue
    aliases.set(normalizeCountryName(c.namePt), { countryId: id, isAmbiguous: false, note: null })
  }

  // Explicit aliases from the source override the automatic ones.
  let unresolved = 0
  for (const a of COUNTRY_ALIAS_SEED) {
    const id = byIso2.get(a.iso2)
    if (id === undefined) {
      console.warn(`[seed] alias "${a.alias}" references unknown ISO2 ${a.iso2}`)
      unresolved += 1
      continue
    }
    aliases.set(normalizeCountryName(a.alias), {
      countryId: id,
      isAmbiguous: a.isAmbiguous ?? false,
      note: a.note ?? null,
    })
  }

  await db
    .insert(countryAliases)
    .values(
      [...aliases].map(([aliasNorm, v]) => ({
        aliasNorm,
        countryId: v.countryId,
        isAmbiguous: v.isAmbiguous,
        note: v.note,
      })),
    )
    .onConflictDoUpdate({
      target: countryAliases.aliasNorm,
      set: {
        countryId: sql`excluded.country_id`,
        isAmbiguous: sql`excluded.is_ambiguous`,
        note: sql`excluded.note`,
      },
    })

  console.log(`[seed] country aliases: ${aliases.size}${unresolved ? ` (unresolved: ${unresolved})` : ''}`)
  return byIso2
}

async function seedStates(): Promise<void> {
  await db
    .insert(brStates)
    .values(BR_STATE_SEED.map((s) => ({ ...s })))
    .onConflictDoUpdate({
      target: brStates.uf,
      set: {
        namePt: sql`excluded.name_pt`,
        nameEn: sql`excluded.name_en`,
        nameRu: sql`excluded.name_ru`,
        region: sql`excluded.region`,
      },
    })

  const rows = await db.select({ id: brStates.id, uf: brStates.uf }).from(brStates)
  const byUf = new Map(rows.map((r) => [r.uf, r.id]))

  const aliases = new Map<string, number>()
  for (const s of BR_STATE_SEED) {
    const id = byUf.get(s.uf)
    if (id === undefined) continue
    aliases.set(normalizeKey(s.namePt), id)
    // The state name appears both with and without the word "estado".
    // Normalization produces the same key either way, so no extra forms are needed.
  }
  for (const a of BR_STATE_ALIAS_SEED) {
    const id = byUf.get(a.uf)
    if (id !== undefined) aliases.set(normalizeKey(a.alias), id)
  }

  await db
    .insert(brStateAliases)
    .values([...aliases].map(([aliasNorm, stateId]) => ({ aliasNorm, stateId })))
    .onConflictDoUpdate({
      target: brStateAliases.aliasNorm,
      set: { stateId: sql`excluded.state_id` },
    })

  console.log(`[seed] states: ${rows.length}, aliases: ${aliases.size}`)
}

async function seedReasons(): Promise<void> {
  await db
    .insert(reasonCategories)
    .values(REASON_CATEGORY_SEED.map((c) => ({ ...c })))
    .onConflictDoUpdate({
      target: reasonCategories.code,
      set: {
        nameRu: sql`excluded.name_ru`,
        nameEn: sql`excluded.name_en`,
        colorSlot: sql`excluded.color_slot`,
        sortOrder: sql`excluded.sort_order`,
      },
    })

  const catRows = await db
    .select({ id: reasonCategories.id, code: reasonCategories.code })
    .from(reasonCategories)
  const byCode = new Map(catRows.map((r) => [r.code, r.id]))

  const values = []
  for (const r of REASON_SEED) {
    const categoryId = byCode.get(r.categoryCode)
    if (categoryId === undefined) {
      throw new Error(`reason "${r.slug}" references unknown category "${r.categoryCode}"`)
    }
    values.push({
      slug: r.slug,
      normalizedKey: reasonDedupKey(r.textPt).textNorm,
      textPt: r.textPt,
      textEn: r.textEn,
      textRu: r.textRu,
      categoryId,
      status: 'active' as const,
      source: 'rule' as const,
    })
  }

  // Manual edits aren't overwritten: the row is only updated if
  // is_manually_edited = false.
  await db
    .insert(reasons)
    .values(values)
    .onConflictDoUpdate({
      target: reasons.slug,
      set: {
        normalizedKey: sql`excluded.normalized_key`,
        textPt: sql`excluded.text_pt`,
        textEn: sql`excluded.text_en`,
        textRu: sql`excluded.text_ru`,
        categoryId: sql`excluded.category_id`,
      },
      setWhere: eq(reasons.isManuallyEdited, false),
    })

  console.log(`[seed] categories: ${catRows.length}, atomic reasons: ${values.length}`)
}

try {
  await seedCountries()
  await seedStates()
  await seedReasons()
  console.log('[seed] reference data ready')
} catch (error) {
  console.error('[seed] error:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
