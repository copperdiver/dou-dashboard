import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { acts, approvals, countries, denials, sourcePages } from '../../db/schema'
import { formatCursor, PAGE_SIZE, type Cursor, type Page } from './feeds'

/**
 * Feed of processed DOU publications.
 *
 * Counters are computed on the fly rather than taken from the
 * `source_page_stats` mart: the feed is sorted by edition date, not by
 * an aggregate, so keyset pagination relies on the
 * `source_pages_edition_date_idx` index and nothing needs to be
 * materialized. A mart would only be needed if sorting by number of
 * people were added.
 *
 * Only parsed pages make it into the result, and only ones with at
 * least one person record. Pages without people and without decisions
 * are headings like "Despachos" with no content: nothing to read there.
 *
 * The selection condition is broader than "has approvals or new
 * denials": a page where every decision is a case archival or an
 * appeal upheld still contains data about people and shouldn't be
 * dropped. Such pages show a count of other decisions.
 */

export type ArticleItem = {
  id: string
  editionDate: string
  title: string
  url: string
  acts: number
  approvals: number
  denials: number
  /** Archivals, upheld denials, and other case decisions. */
  otherDecisions: number
  /** Most common country of birth among the page's approvals. */
  topCountryIso2: string | null
  topCountryRu: string | null
  topCountryEn: string | null
}

export async function getArticles(cursor: Cursor | null): Promise<Page<ArticleItem>> {
  const { rows } = await db.execute<{
    id: string
    edition_date: string
    title: string | null
    url_title: string
    url: string
    acts: number
    approvals: number
    denials: number
    other_decisions: number
    iso2: string | null
    country_ru: string | null
    country_en: string | null
  }>(sql`
    select
      p.id::text,
      to_char(p.edition_date, 'YYYY-MM-DD') as edition_date,
      p.title, p.url_title, p.url,
      (select count(*)::int from ${acts} a where a.page_id = p.id)                as acts,
      (select count(*)::int from ${approvals} ap
        where ap.page_id = p.id and ap.retired_at is null
          and ap.counts_as_new_approval)                                          as approvals,
      -- Only count new denials: upheld appeals and republications
      -- shouldn't inflate the page counter.
      (select count(*)::int from ${denials} dn
        where dn.page_id = p.id and dn.retired_at is null
          and dn.counts_as_new_denial)                                            as denials,
      (select count(*)::int from ${denials} dn
        where dn.page_id = p.id and dn.retired_at is null
          and not dn.counts_as_new_denial)                                        as other_decisions,
      top.iso2, top.name_ru as country_ru, top.name_en as country_en
      from ${sourcePages} p
      left join lateral (
        select c.iso2, c.name_ru, c.name_en
          from ${approvals} ap
          join ${countries} c on c.id = ap.country_id
         where ap.page_id = p.id and ap.retired_at is null
           and ap.counts_as_new_approval
         group by c.iso2, c.name_ru, c.name_en
         order by count(*) desc, c.name_en
         limit 1
      ) top on true
     where p.parse_status = 'ok'
       -- Via exists rather than comparing the columns computed above:
       -- this way the planner stops at the first matching row instead
       -- of counting the whole page just to answer "empty or not".
       and (
         exists (select 1 from ${approvals} ap
                  where ap.page_id = p.id and ap.retired_at is null
                    and ap.counts_as_new_approval)
         or exists (select 1 from ${denials} dn
                     where dn.page_id = p.id and dn.retired_at is null)
       )
       ${cursor ? sql` and (p.edition_date, p.id) < (${cursor.day}::date, ${cursor.id}::uuid)` : sql``}
     order by p.edition_date desc, p.id desc
     limit ${PAGE_SIZE + 1}
  `)

  const hasMore = rows.length > PAGE_SIZE
  const shown = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const last = shown[shown.length - 1]

  return {
    items: shown.map((r) => ({
      id: r.id,
      editionDate: r.edition_date,
      // The source title can be empty. Then the fallback is a
      // human-readable URL fragment that at least identifies the article.
      title: r.title?.trim() || r.url_title,
      url: r.url,
      acts: r.acts,
      approvals: r.approvals,
      denials: r.denials,
      otherDecisions: r.other_decisions,
      topCountryIso2: r.iso2,
      topCountryRu: r.country_ru,
      topCountryEn: r.country_en,
    })),
    next: hasMore && last ? formatCursor({ day: last.edition_date, id: last.id }) : null,
  }
}
