import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import {
  approvals,
  dailyAgeBucketStats,
  dailyReasonCategoryStats,
  dailyStats,
  denialReasons,
  denials,
  ingestDays,
  reasonCategories,
} from '../../db/schema'
import type { AgeBucket } from '../../db/schema'
import { addDays } from '../range'

/**
 * Запросы сводки. Все читают суточные витрины, а не факты: витрина —
 * единственное место, где записано определение «нового отказа» и где
 * различаются «ноль» и «нет данных».
 */

export type DataBounds = { min: string; max: string }

/** Границы загруженного периода. Нужны пресету «весь период». */
export async function getDataBounds(): Promise<DataBounds | null> {
  const { rows } = await db.execute<{ min: string | null; max: string | null }>(sql`
    select to_char(min(day), 'YYYY-MM-DD') as min,
           to_char(max(day), 'YYYY-MM-DD') as max
      from ${dailyStats}
  `)

  const row = rows[0]
  if (!row?.min || !row?.max) return null
  return { min: row.min, max: row.max }
}

/**
 * Состав «прочих решений». Витрина хранит только сумму, поэтому разбивка
 * берётся из фактов: держать в `daily_stats` колонку под каждый вид
 * решения ради подписи на одной плитке не стоит.
 */
export type OtherDecisions = {
  /** Производство прекращено. */
  archived: number
  /** Отказ подтверждён при обжаловании. */
  upheld: number
  /** Отмены, повторные публикации и прочее. */
  other: number
}

export type Kpis30d = {
  approvals: number
  denials: number
  /** Подтверждения отказа и прочие решения — без новых отказов. */
  otherDecisions: number
  breakdown: OtherDecisions
  /** Доля отказов среди решений по существу, 0..1. null — решений не было. */
  denialRate: number | null
  prev: {
    approvals: number
    denials: number
    otherDecisions: number
    denialRate: number | null
  }
}

/**
 * KPI за 30 суток и за предыдущие 30 для дельты. Окно фиксировано и не
 * зависит от периода графиков: плитки отвечают на вопрос «что сейчас»,
 * а выбор периода — инструмент разглядывания рядов.
 */
export async function getKpis30d(anchor: string): Promise<Kpis30d> {
  const currentFrom = addDays(anchor, -29)
  const prevTo = addDays(currentFrom, -1)
  const prevFrom = addDays(prevTo, -29)

  const [totals, breakdown] = await Promise.all([
    db.execute<{
      approvals: number
      denials: number
      other_decisions: number
      prev_approvals: number
      prev_denials: number
      prev_other_decisions: number
    }>(sql`
    select
      coalesce(sum(approvals)   filter (where day between ${currentFrom} and ${anchor}), 0)::int as approvals,
      coalesce(sum(denials_new) filter (where day between ${currentFrom} and ${anchor}), 0)::int as denials,
      coalesce(sum(denials_upheld + other_decisions)
                                filter (where day between ${currentFrom} and ${anchor}), 0)::int as other_decisions,
      coalesce(sum(approvals)   filter (where day between ${prevFrom} and ${prevTo}), 0)::int    as prev_approvals,
      coalesce(sum(denials_new) filter (where day between ${prevFrom} and ${prevTo}), 0)::int    as prev_denials,
      coalesce(sum(denials_upheld + other_decisions)
                                filter (where day between ${prevFrom} and ${prevTo}), 0)::int    as prev_other_decisions
      from ${dailyStats}
  `),
    /*
     * Разбивка задана теми же условиями, что и в насосе витрин, и группы
     * не пересекаются: подтверждение при обжаловании, прекращение
     * производства и всё остальное. Их сумма обязана совпадать с
     * other_decisions из витрины.
     */
    db.execute<{ archived: number; upheld: number; other: number }>(sql`
      select
        count(*) filter (where not counts_as_new_denial and not is_upheld
                           and decision_kind = 'archived')::int              as archived,
        count(*) filter (where is_upheld)::int                               as upheld,
        count(*) filter (where not counts_as_new_denial and not is_upheld
                           and decision_kind <> 'archived')::int             as other
        from ${denials}
       where edition_date between ${currentFrom} and ${anchor}
         and retired_at is null
    `),
  ])

  const row = totals.rows[0]
  const parts = breakdown.rows[0]
  const a = row?.approvals ?? 0
  const d = row?.denials ?? 0
  const pa = row?.prev_approvals ?? 0
  const pd = row?.prev_denials ?? 0

  return {
    approvals: a,
    denials: d,
    otherDecisions: row?.other_decisions ?? 0,
    breakdown: {
      archived: parts?.archived ?? 0,
      upheld: parts?.upheld ?? 0,
      other: parts?.other ?? 0,
    },
    denialRate: a + d > 0 ? d / (a + d) : null,
    prev: {
      approvals: pa,
      denials: pd,
      otherDecisions: row?.prev_other_decisions ?? 0,
      denialRate: pa + pd > 0 ? pd / (pa + pd) : null,
    },
  }
}

/**
 * Почему за день нет чисел. Различать обязательно: «выпуска не было» —
 * это отсутствие события (публиковать было нечего, линия законно идёт
 * через такой день), а «не загружен» — отсутствие знания, и делать вид,
 * что мы его наблюдали, нельзя.
 */
export type DayCoverage = 'covered' | 'no_edition' | 'missing'

export type DayPoint = {
  /** `YYYY-MM-DD`. */
  day: string
  /** null — наблюдения за день нет; смотри `coverage`, почему. */
  approvals: number | null
  denials: number | null
  /** Подтверждения отказа и прочие решения. */
  otherDecisions: number | null
  coverage: DayCoverage
}

/**
 * Ряд по дням.
 *
 * Календарь генерируется запросом, а витрина присоединяется слева.
 * Строки в витрине нет — это ещё не «нет данных»: витрина заполняется
 * только для дней, где что-то нашлось. Поэтому такие дни доспрашиваются
 * у `ingest_days`:
 *
 *  - `enumerated` — выпуск разобран, релевантных публикаций не было.
 *    Это наблюдение, и значение равно нулю, а не пропуску.
 *  - `no_edition` — выпуска не было. Публиковать было нечего.
 *  - записи нет вовсе — день ни разу не ставили в очередь, и что там
 *    было, мы не знаем. Только это и есть настоящий пробел.
 */
export async function getDailySeries(from: string, to: string): Promise<DayPoint[]> {
  const { rows } = await db.execute<{
    day: string
    approvals: number | null
    denials: number | null
    other_decisions: number | null
    coverage: DayCoverage
  }>(sql`
    with calendar as (
      select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day
    )
    select
      to_char(c.day, 'YYYY-MM-DD') as day,
      case
        when s.coverage = 'covered' then s.approvals
        when s.day is null and i.enumerated then 0
      end as approvals,
      case
        when s.coverage = 'covered' then s.denials_new
        when s.day is null and i.enumerated then 0
      end as denials,
      case
        when s.coverage = 'covered' then s.denials_upheld + s.other_decisions
        when s.day is null and i.enumerated then 0
      end as other_decisions,
      case
        when s.coverage is not null then s.coverage::text
        when i.enumerated  then 'covered'
        when i.no_edition  then 'no_edition'
        else 'missing'
      end as coverage
      from calendar c
      left join ${dailyStats} s on s.day = c.day
      left join lateral (
        select bool_or(status = 'enumerated') as enumerated,
               bool_or(status = 'no_edition') as no_edition
          from ${ingestDays} d where d.edition_date = c.day
      ) i on true
     order by c.day
  `)

  return rows.map((r) => ({
    day: r.day,
    approvals: r.approvals,
    denials: r.denials,
    otherDecisions: r.other_decisions,
    coverage: r.coverage,
  }))
}

export type CategoryBreakdown = {
  rows: CategoryTotal[]
  /** Отказы, у которых определена хотя бы одна причина. */
  classified: number
  /** Новые отказы за период всего. */
  total: number
}

export type CategoryTotal = {
  id: number
  code: string
  nameRu: string
  nameEn: string
  /** Слот палитры 1..8: тот же цвет, что у линии в дрилл-дауне. */
  colorSlot: number
  denials: number
}

/**
 * Итоги по категориям причин за период.
 *
 * Метрика витрины — число отказов, затронутых категорией. У отказа
 * бывает несколько причин из разных категорий, поэтому сумма по
 * категориям больше числа отказов, и подпись графика обязана это назвать.
 *
 * Вместе с итогами возвращается число отказов с определённой причиной:
 * доли считаются от него, а не от всех отказов. Отказ без единой причины
 * не может попасть ни в один числитель, и держать его в знаменателе —
 * значит занижать все доли разом.
 */
export async function getReasonCategoryTotals(
  from: string,
  to: string,
): Promise<CategoryBreakdown> {
  const [totals, counts] = await Promise.all([
    db.execute<{
      id: number
      code: string
      name_ru: string
      name_en: string
      color_slot: number
      denials: number
    }>(sql`
      select
        c.id, c.code, c.name_ru, c.name_en, c.color_slot,
        coalesce(sum(s.denials), 0)::int as denials
        from ${reasonCategories} c
        left join ${dailyReasonCategoryStats} s
          on s.category_id = c.id and s.day between ${from} and ${to}
       group by c.id, c.code, c.name_ru, c.name_en, c.color_slot, c.sort_order
       order by denials desc, c.sort_order
    `),
    db.execute<{ total: number; classified: number }>(sql`
      select
        count(*)::int as total,
        count(*) filter (
          where exists (select 1 from ${denialReasons} dr where dr.denial_id = d.id)
        )::int as classified
        from ${denials} d
       where d.retired_at is null
         and d.counts_as_new_denial
         and d.edition_date between ${from} and ${to}
    `),
  ])

  return {
    rows: totals.rows.map((r) => ({
      id: r.id,
      code: r.code,
      nameRu: r.name_ru,
      nameEn: r.name_en,
      colorSlot: r.color_slot,
      denials: r.denials,
    })),
    classified: counts.rows[0]?.classified ?? 0,
    total: counts.rows[0]?.total ?? 0,
  }
}

export type AgeDistribution = {
  buckets: { bucket: AgeBucket; approvals: number }[]
  /** Одобрения без даты рождения в источнике: в группы не попадают. */
  excluded: number
}

/**
 * Возрастные группы за период.
 *
 * Число исключённых обязательно к показу: без него сумма долей не сходится
 * с количеством одобрений, и читатель делает неверный вывод о выборке.
 */
export async function getAgeDistribution(from: string, to: string): Promise<AgeDistribution> {
  const [bucketRows, excludedRows] = await Promise.all([
    db.execute<{ bucket: AgeBucket; approvals: number }>(sql`
      select bucket, sum(approvals)::int as approvals
        from ${dailyAgeBucketStats}
       where day between ${from} and ${to}
       group by bucket
       order by bucket
    `),
    db.execute<{ n: number }>(sql`
      select count(*)::int as n
        from ${approvals}
       where edition_date between ${from} and ${to}
         and retired_at is null
         and counts_as_new_approval
         and age_at_publication is null
    `),
  ])

  return {
    buckets: bucketRows.rows,
    excluded: excludedRows.rows[0]?.n ?? 0,
  }
}
