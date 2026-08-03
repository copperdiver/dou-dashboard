import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import {
  approvals,
  brStates,
  countries,
  dailyCountryStats,
  dailyStateStats,
  denialReasons,
  denials,
  reasonCategories,
  reasons,
  sourcePages,
} from '../../db/schema'
import { normalizeName } from '../text'

/**
 * Approval and denial feeds.
 *
 * Pagination is keyset-based on `(edition_date desc, id desc)`, exactly
 * matching the composite indexes `approvals_feed_idx` and
 * `denials_feed_idx`. Offset pagination won't work here: feed pages page
 * deep into history, and on page ten the DB would reread the whole
 * beginning again, while inserting a fresh day would shift the boundary
 * and duplicate records at the seam.
 */

export const PAGE_SIZE = 25

export type Cursor = { day: string; id: string }

/** Cursor in the URL: `YYYY-MM-DD_uuid`. */
export function parseCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null
  const separator = raw.indexOf('_')
  if (separator !== 10) return null

  const day = raw.slice(0, separator)
  const id = raw.slice(separator + 1)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[0-9a-f-]{36}$/i.test(id)) return null

  return { day, id }
}

export function formatCursor(cursor: Cursor): string {
  return `${cursor.day}_${cursor.id}`
}

export type Page<T> = {
  items: T[]
  /** Cursor for the next page. null means there's nothing further. */
  next: string | null
}

/**
 * Search condition for name matching.
 *
 * The key is built with the same `normalizeName` used to fill the
 * `name_norm` column on write: two normalization implementations would
 * inevitably diverge, and search would start losing records with
 * diacritics. `like '%…%'` here doesn't cause a full scan: it's served
 * by the trigram gin index.
 */
function nameFilter(column: string, query: string | undefined) {
  const normalized = query ? normalizeName(query) : ''
  if (normalized.length < 2) return sql``
  return sql` and ${sql.raw(column)} like ${'%' + normalized + '%'}`
}

/* ── Approvals ─────────────────────────────────────────────────────────── */

export type ApprovalItem = {
  id: string
  editionDate: string
  fullName: string
  countryIso2: string | null
  countryNameRu: string | null
  countryNameEn: string | null
  stateUf: string | null
  stateNameRu: string | null
  stateNameEn: string | null
  birthDate: string | null
  age: number | null
  processNumber: string | null
  sourceUrl: string
}

export type ApprovalFilters = {
  country?: string
  state?: string
  q?: string
}

export async function getApprovals(
  filters: ApprovalFilters,
  cursor: Cursor | null,
): Promise<Page<ApprovalItem>> {
  const { rows } = await db.execute<{
    id: string
    edition_date: string
    full_name: string
    iso2: string | null
    country_ru: string | null
    country_en: string | null
    uf: string | null
    state_ru: string | null
    state_en: string | null
    birth_date: string | null
    age_at_publication: number | null
    process_number: string | null
    url: string
  }>(sql`
    select
      a.id::text, to_char(a.edition_date, 'YYYY-MM-DD') as edition_date, a.full_name,
      c.iso2, c.name_ru as country_ru, c.name_en as country_en,
      s.uf, s.name_ru as state_ru, s.name_en as state_en,
      to_char(a.birth_date, 'YYYY-MM-DD') as birth_date,
      a.age_at_publication, a.process_number, p.url
      from ${approvals} a
      left join ${countries} c on c.id = a.country_id
      left join ${brStates} s on s.id = a.state_id
      join ${sourcePages} p on p.id = a.page_id
     where a.retired_at is null
       -- Republications of the same portaria are excluded: otherwise
       -- one person would appear in the feed multiple times.
       and a.counts_as_new_approval
       ${filters.country ? sql` and c.iso2 = ${filters.country}` : sql``}
       ${filters.state ? sql` and s.uf = ${filters.state}` : sql``}
       ${nameFilter('a.name_norm', filters.q)}
       ${cursor ? sql` and (a.edition_date, a.id) < (${cursor.day}::date, ${cursor.id}::uuid)` : sql``}
     order by a.edition_date desc, a.id desc
     limit ${PAGE_SIZE + 1}
  `)

  return paginate(
    rows.map((r) => ({
      id: r.id,
      editionDate: r.edition_date,
      fullName: r.full_name,
      countryIso2: r.iso2,
      countryNameRu: r.country_ru,
      countryNameEn: r.country_en,
      stateUf: r.uf,
      stateNameRu: r.state_ru,
      stateNameEn: r.state_en,
      birthDate: r.birth_date,
      age: r.age_at_publication,
      processNumber: r.process_number,
      sourceUrl: r.url,
    })),
  )
}

/* ── Denials ───────────────────────────────────────────────────────────── */

export type DenialReasonItem = {
  categoryId: number
  categoryNameRu: string
  categoryNameEn: string
  colorSlot: number
  textPt: string
  textRu: string | null
  textEn: string | null
}

export type DenialItem = {
  id: string
  editionDate: string
  fullName: string
  processNumber: string | null
  decisionKind: string
  isUpheld: boolean
  isRepublication: boolean
  /** Whether there's a link to the primary decision: an upheld denial without one is called out. */
  hasPrimary: boolean
  sourceUrl: string
  reasons: DenialReasonItem[]
}

export type DenialFilters = {
  category?: string
  q?: string
  /** Show upheld denials and other decisions. */
  includeUpheld?: boolean
}

export async function getDenials(
  filters: DenialFilters,
  cursor: Cursor | null,
): Promise<Page<DenialItem>> {
  const { rows } = await db.execute<{
    id: string
    edition_date: string
    full_name: string
    process_number: string | null
    decision_kind: string
    is_upheld: boolean
    is_republication: boolean
    has_primary: boolean
    url: string
  }>(sql`
    select
      d.id::text, to_char(d.edition_date, 'YYYY-MM-DD') as edition_date, d.full_name,
      d.process_number, d.decision_kind, d.is_upheld, d.is_republication,
      (d.appeal_of_id is not null) as has_primary, p.url
      from ${denials} d
      join ${sourcePages} p on p.id = d.page_id
     where d.retired_at is null
       ${filters.includeUpheld ? sql`` : sql` and d.counts_as_new_denial`}
       ${
         filters.category
           ? sql` and exists (
                    select 1 from ${denialReasons} dr
                      join ${reasonCategories} rc on rc.id = dr.category_id
                     where dr.denial_id = d.id and rc.code = ${filters.category})`
           : sql``
       }
       ${nameFilter('d.name_norm', filters.q)}
       ${cursor ? sql` and (d.edition_date, d.id) < (${cursor.day}::date, ${cursor.id}::uuid)` : sql``}
     order by d.edition_date desc, d.id desc
     limit ${PAGE_SIZE + 1}
  `)

  const page = paginate(rows)
  const ids = page.items.map((r) => r.id)
  const reasonsByDenial = await getReasonsFor(ids)

  return {
    next: page.next,
    items: page.items.map((r) => ({
      id: r.id,
      editionDate: r.edition_date,
      fullName: r.full_name,
      processNumber: r.process_number,
      decisionKind: r.decision_kind,
      isUpheld: r.is_upheld,
      isRepublication: r.is_republication,
      hasPrimary: r.has_primary,
      sourceUrl: r.url,
      reasons: reasonsByDenial.get(r.id) ?? [],
    })),
  }
}

/**
 * Reasons for the displayed page of denials. A separate query.
 *
 * They can't be joined into the main query: a denial can have several
 * reasons, so rows would multiply and `limit` would cut off by
 * relations, not records, and the page would come out shorter than
 * requested.
 */
async function getReasonsFor(ids: string[]): Promise<Map<string, DenialReasonItem[]>> {
  const result = new Map<string, DenialReasonItem[]>()
  if (ids.length === 0) return result

  const { rows } = await db.execute<{
    denial_id: string
    category_id: number
    category_ru: string
    category_en: string
    color_slot: number
    text_pt: string
    text_ru: string | null
    text_en: string | null
  }>(sql`
    select
      dr.denial_id::text, dr.category_id,
      rc.name_ru as category_ru, rc.name_en as category_en, rc.color_slot,
      r.text_pt, r.text_ru, r.text_en
      from ${denialReasons} dr
      join ${reasons} r on r.id = dr.reason_id
      join ${reasonCategories} rc on rc.id = dr.category_id
     where dr.denial_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
     order by rc.sort_order
  `)

  for (const row of rows) {
    const list = result.get(row.denial_id) ?? []
    list.push({
      categoryId: row.category_id,
      categoryNameRu: row.category_ru,
      categoryNameEn: row.category_en,
      colorSlot: row.color_slot,
      textPt: row.text_pt,
      textRu: row.text_ru,
      textEn: row.text_en,
    })
    result.set(row.denial_id, list)
  }

  return result
}

/* ── Reference lists for filters ───────────────────────────────────────── */

export type CountryOption = { iso2: string; nameRu: string; nameEn: string; approvals: number }

/**
 * Countries appearing in approvals, most frequent first.
 * A 95-entry alphabetical list would make you hunt for Haiti at the end.
 */
export async function getCountryOptions(): Promise<CountryOption[]> {
  const { rows } = await db.execute<{
    iso2: string
    name_ru: string
    name_en: string
    approvals: number
  }>(sql`
    select c.iso2, c.name_ru, c.name_en, sum(s.approvals)::int as approvals
      from ${dailyCountryStats} s
      join ${countries} c on c.id = s.country_id
     group by c.iso2, c.name_ru, c.name_en
     having sum(s.approvals) > 0
     order by approvals desc, c.name_en
  `)

  return rows.map((r) => ({
    iso2: r.iso2,
    nameRu: r.name_ru,
    nameEn: r.name_en,
    approvals: r.approvals,
  }))
}

export type StateOption = { uf: string; nameRu: string; nameEn: string; approvals: number }

export async function getStateOptions(): Promise<StateOption[]> {
  const { rows } = await db.execute<{
    uf: string
    name_ru: string
    name_en: string
    approvals: number
  }>(sql`
    select b.uf, b.name_ru, b.name_en, sum(s.approvals)::int as approvals
      from ${dailyStateStats} s
      join ${brStates} b on b.id = s.state_id
     group by b.uf, b.name_ru, b.name_en
     having sum(s.approvals) > 0
     order by approvals desc, b.name_en
  `)

  return rows.map((r) => ({
    uf: r.uf,
    nameRu: r.name_ru,
    nameEn: r.name_en,
    approvals: r.approvals,
  }))
}

export type CategoryOption = { code: string; nameRu: string; nameEn: string; colorSlot: number }

export async function getCategoryOptions(): Promise<CategoryOption[]> {
  const { rows } = await db.execute<{
    code: string
    name_ru: string
    name_en: string
    color_slot: number
  }>(sql`
    select code, name_ru, name_en, color_slot
      from ${reasonCategories}
     order by sort_order
  `)

  return rows.map((r) => ({
    code: r.code,
    nameRu: r.name_ru,
    nameEn: r.name_en,
    colorSlot: r.color_slot,
  }))
}

/**
 * We fetch one record more than requested: the extra row answers the
 * "is there a next page" question without a second count query.
 */
function paginate<T extends { edition_date?: string; editionDate?: string; id: string }>(
  rows: T[],
): Page<T> {
  const hasMore = rows.length > PAGE_SIZE
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const last = items[items.length - 1]

  return {
    items,
    next:
      hasMore && last
        ? formatCursor({ day: last.edition_date ?? last.editionDate ?? '', id: last.id })
        : null,
  }
}
