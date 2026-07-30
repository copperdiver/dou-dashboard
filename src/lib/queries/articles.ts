import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { acts, approvals, countries, denials, sourcePages } from '../../db/schema'
import { formatCursor, PAGE_SIZE, type Cursor, type Page } from './feeds'

/**
 * Фид обработанных публикаций DOU.
 *
 * Счётчики считаются на лету, а не берутся из витрины `source_page_stats`:
 * фид отсортирован по дате выпуска, а не по агрегату, поэтому keyset-
 * пагинация опирается на индекс `source_pages_edition_date_idx` и
 * материализовать ничего не нужно. Витрина понадобится, только если
 * появится сортировка по числу людей.
 *
 * В выдачу попадают лишь разобранные страницы, и только те, где есть хоть
 * одна запись о человеке. Страницы без людей и без решений — это заголовки
 * вроде «Despachos» без содержимого, читать в них нечего.
 *
 * Условие отбора шире, чем «есть одобрения или новые отказы»: страница,
 * где все решения — прекращения производства или подтверждения при
 * обжаловании, содержит данные о людях и выкидывать её нельзя. Такие
 * страницы показывают счётчик прочих решений.
 */

export type ArticleItem = {
  id: string
  editionDate: string
  title: string
  url: string
  acts: number
  approvals: number
  denials: number
  /** Прекращения, подтверждения отказа и прочие решения по делам. */
  otherDecisions: number
  /** Самая частая страна рождения среди одобрений страницы. */
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
      -- Считаем только новые отказы: подтверждения при обжаловании и
      -- повторные публикации не должны раздувать счётчик страницы.
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
       -- Через exists, а не сравнением посчитанных выше колонок: так
       -- планировщик останавливается на первой найденной записи и не
       -- считает всю страницу ради ответа «пусто или нет».
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
      // Заголовок источника бывает пустым — тогда остаётся человекочитаемый
      // фрагмент адреса, по которому статью хотя бы можно опознать.
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
