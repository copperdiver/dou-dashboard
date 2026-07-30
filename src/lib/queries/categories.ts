import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { dailyReasonCategoryStats, dailyStats, reasonCategories } from '../../db/schema'

/**
 * Ряды «категория причины × день» для дрилл-дауна.
 *
 * Считаются из витрины `daily_reason_category_stats`: ради этого разреза
 * она и заведена — иначе каждая точка графика требовала бы join через
 * denial_reasons, denials и reason_categories.
 *
 * Различаются три случая, и путать их нельзя:
 *  - день загружен, отказов по категории не было → 0;
 *  - день загружен, но выпуска не было или он не загружен → null, разрыв;
 *  - дня нет в витрине вовсе → тоже null.
 */

export type CategorySeries = {
  code: string
  nameRu: string
  nameEn: string
  colorSlot: number
  total: number
  /** По одному значению на день из `days`, в том же порядке. */
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

    // Календарь общий для всех категорий, поэтому дни собираем по первой.
    if (byCode.size === 1) days.push(row.day)
  }

  return { days, series: [...byCode.values()] }
}
