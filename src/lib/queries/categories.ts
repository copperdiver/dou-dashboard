import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { dailyReasonCategoryStats, dailyStats, reasonCategories } from '../../db/schema'

/**
 * "Reason category x day" rows for the drilldown.
 *
 * Computed from the `daily_reason_category_stats` mart: it was created
 * precisely for this breakdown: otherwise every chart point would need
 * a join through denial_reasons, denials, and reason_categories.
 *
 * Three cases are distinguished, and they must not be conflated:
 *  - the day is loaded, no denials for the category → 0;
 *  - the day is loaded, but there was no edition or it isn't loaded → null, a gap;
 *  - the day isn't in the mart at all → also null.
 */

export type CategorySeries = {
  code: string
  nameRu: string
  nameEn: string
  colorSlot: number
  total: number
  /** One value per day from `days`, in the same order. */
  values: (number | null)[]
}

export type CategoryDrilldown = {
  days: string[]
  series: CategorySeries[]
}

export async function getCategorySeries(from: string, to: string): Promise<CategoryDrilldown> {
  const { rows } = await db.execute<{
    day: string
    code: string
    name_ru: string
    name_en: string
    color_slot: number
    sort_order: number
    denials: number | null
  }>(sql`
    with calendar as (
      select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day
    )
    select
      to_char(c.day, 'YYYY-MM-DD') as day,
      cat.code, cat.name_ru, cat.name_en, cat.color_slot, cat.sort_order,
      case when ds.coverage = 'covered' then coalesce(s.denials, 0) end as denials
      from calendar c
      cross join ${reasonCategories} cat
      left join ${dailyStats} ds on ds.day = c.day
      left join ${dailyReasonCategoryStats} s
        on s.day = c.day and s.category_id = cat.id
     order by cat.sort_order, c.day
  `)

  const days: string[] = []
  const byCode = new Map<string, CategorySeries>()

  for (const row of rows) {
    if (!byCode.has(row.code)) {
      byCode.set(row.code, {
        code: row.code,
        nameRu: row.name_ru,
        nameEn: row.name_en,
        colorSlot: row.color_slot,
        total: 0,
        values: [],
      })
    }

    const series = byCode.get(row.code)!
    series.values.push(row.denials)
    series.total += row.denials ?? 0

    // The calendar is shared across all categories, so days are collected from the first one.
    if (byCode.size === 1) days.push(row.day)
  }

  return { days, series: [...byCode.values()] }
}
