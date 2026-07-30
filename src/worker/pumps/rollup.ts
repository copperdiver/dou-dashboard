import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import {
  approvals,
  dailyAgeBucketStats,
  dailyCountryStats,
  dailyReasonCategoryStats,
  dailyStateStats,
  dailyStats,
  denialReasons,
  denials,
  dirtyDays,
  ingestDays,
  sourcePages,
} from '../../db/schema'
import type { Pump } from './types'

/**
 * Пересчёт суточных витрин по дням из `dirty_days`.
 *
 * Витрины здесь нужны НЕ для скорости: на 14 тыс. одобрений любой график
 * считается за единицы миллисекунд по индексам. Они нужны для трёх других
 * вещей:
 *
 *  1. Единое определение «нового отказа» — в одном месте, а не размазанное
 *     по семи запросам.
 *  2. Различение «нет данных» и «ноль». День без выпуска и день, который
 *     не удалось загрузить, — это не «ноль одобрений», и `coverage`
 *     берётся из `ingest_days`, а не из фактов.
 *  3. Дрилл-даун «категория × день» без join через три таблицы на каждую
 *     точку графика.
 *
 * Пересчёт дня — удаление и вставка в одной транзакции: идемпотентно
 * и перезапускаемо. Полный ребилд — засеять `dirty_days` нужным
 * диапазоном.
 */

const BATCH = 30

type Claim = { day: string }

async function claimDays(limit: number): Promise<Claim[]> {
  // Захват удалением: строка-маркер и есть единица работы, поэтому
  // отдельная аренда не нужна — упавший прогон просто потеряет маркер,
  // а его вернёт следующий parse/canonize.
  const result = await db.execute<Claim>(sql`
    with candidates as (
      select day from ${dirtyDays}
      order by day desc
      limit ${limit}
      for update skip locked
    )
    delete from ${dirtyDays} d
     using candidates c
     where d.day = c.day
    returning d.day
  `)

  return result.rows
}

/**
 * Возрастные группы фиксированы в коде: границы должны совпадать
 * с подписями на графике, а их изменение — осознанным событием,
 * а не следствием правки SQL.
 */
const AGE_BUCKET_SQL = sql`
  case
    when age_at_publication < 18 then '0-17'
    when age_at_publication < 25 then '18-24'
    when age_at_publication < 35 then '25-34'
    when age_at_publication < 45 then '35-44'
    when age_at_publication < 55 then '45-54'
    when age_at_publication < 65 then '55-64'
    else '65+'
  end
`

export const rollupDays: Pump = async ({ log }) => {
  const claims = await claimDays(BATCH)
  if (claims.length === 0) return { itemsProcessed: 0, meta: { days: 0 } }

  let approvalsTotal = 0
  let denialsTotal = 0
  let missing = 0

  for (const { day } of claims) {
    await db.transaction(async (tx) => {
      /*
       * coverage берётся из ingest_days, а не из фактов: иначе
       * невозможно отличить «в этот день никого не натурализовали»
       * от «этот день мы не загрузили». Фронтенд по `missing`/`no_edition`
       * рисует разрыв линии, а не нулевую точку.
       */
      const [coverageRow] = await tx.execute<{ coverage: string }>(sql`
        select case
                 when count(*) = 0 then 'missing'
                 when count(*) filter (where status = 'enumerated') > 0 then 'covered'
                 when count(*) filter (where status = 'no_edition') > 0 then 'no_edition'
                 else 'missing'
               end as coverage
          from ${ingestDays}
         where edition_date = ${day}
      `).then((r) => r.rows)

      const coverage = coverageRow?.coverage ?? 'missing'
      if (coverage !== 'covered') missing += 1

      const [totals] = await tx.execute<{
        approvals: number
        denials_new: number
        denials_upheld: number
        other_decisions: number
        pages: number
        acts: number
      }>(sql`
        select
          -- Определение «нового одобрения» живёт в counts_as_new_approval:
          -- повторная публикация той же portaria в него не входит, иначе
          -- один человек считался бы дважды.
          (select count(*)::int from ${approvals}
            where edition_date = ${day} and retired_at is null
              and counts_as_new_approval)                                            as approvals,
          -- Определение «нового отказа» живёт в counts_as_new_denial:
          -- подтверждение при обжаловании и повторная публикация в него
          -- не входят, иначе статистика удвоилась бы.
          (select count(*)::int from ${denials}
            where edition_date = ${day} and retired_at is null
              and counts_as_new_denial)                                              as denials_new,
          (select count(*)::int from ${denials}
            where edition_date = ${day} and retired_at is null and is_upheld)        as denials_upheld,
          (select count(*)::int from ${denials}
            where edition_date = ${day} and retired_at is null
              and not counts_as_new_denial and not is_upheld)                        as other_decisions,
          (select count(*)::int from ${sourcePages} where edition_date = ${day})     as pages,
          (select count(*)::int from ${sourcePages} p
             join acts a on a.page_id = p.id where a.edition_date = ${day})          as acts
      `).then((r) => r.rows)

      await tx
        .insert(dailyStats)
        .values({
          day,
          approvals: totals?.approvals ?? 0,
          denialsNew: totals?.denials_new ?? 0,
          denialsUpheld: totals?.denials_upheld ?? 0,
          otherDecisions: totals?.other_decisions ?? 0,
          pages: totals?.pages ?? 0,
          acts: totals?.acts ?? 0,
          coverage: coverage as 'covered' | 'missing' | 'no_edition',
        })
        .onConflictDoUpdate({
          target: dailyStats.day,
          set: {
            approvals: sql`excluded.approvals`,
            denialsNew: sql`excluded.denials_new`,
            denialsUpheld: sql`excluded.denials_upheld`,
            otherDecisions: sql`excluded.other_decisions`,
            pages: sql`excluded.pages`,
            acts: sql`excluded.acts`,
            coverage: sql`excluded.coverage`,
            computedAt: sql`now()`,
          },
        })

      approvalsTotal += totals?.approvals ?? 0
      denialsTotal += totals?.denials_new ?? 0

      // Разрезы: удаление и вставка заново — идемпотентно и не оставляет
      // строк по измерениям, которые за день исчезли.
      await tx.delete(dailyCountryStats).where(sql`${dailyCountryStats.day} = ${day}`)
      await tx.execute(sql`
        insert into ${dailyCountryStats} (day, country_id, approvals)
        select ${day}::date, country_id, count(*)::int
          from ${approvals}
         where edition_date = ${day} and retired_at is null and counts_as_new_approval
           and country_id is not null
         group by country_id
      `)

      await tx.delete(dailyStateStats).where(sql`${dailyStateStats.day} = ${day}`)
      await tx.execute(sql`
        insert into ${dailyStateStats} (day, state_id, approvals)
        select ${day}::date, state_id, count(*)::int
          from ${approvals}
         where edition_date = ${day} and retired_at is null and counts_as_new_approval
           and state_id is not null
         group by state_id
      `)

      await tx.delete(dailyAgeBucketStats).where(sql`${dailyAgeBucketStats.day} = ${day}`)
      await tx.execute(sql`
        insert into ${dailyAgeBucketStats} (day, bucket, approvals)
        select ${day}::date, (${AGE_BUCKET_SQL})::age_bucket, count(*)::int
          from ${approvals}
         where edition_date = ${day} and retired_at is null and counts_as_new_approval
           and age_at_publication is not null
         group by 2
      `)

      /*
       * Метрика категорий — count(distinct denial_id), а НЕ количество
       * связей: у отказа бывает до нескольких причин из разных категорий,
       * поэтому сумма по столбцам не равна числу отказов. Подпись графика
       * обязана это называть: «отказов, затронутых категорией».
       */
      await tx.delete(dailyReasonCategoryStats).where(sql`${dailyReasonCategoryStats.day} = ${day}`)
      await tx.execute(sql`
        insert into ${dailyReasonCategoryStats} (day, category_id, denials)
        select ${day}::date, dr.category_id, count(distinct dr.denial_id)::int
          from ${denialReasons} dr
          join ${denials} d on d.id = dr.denial_id
         where dr.edition_date = ${day}
           and d.retired_at is null
           and d.counts_as_new_denial
         group by dr.category_id
      `)
    })
  }

  log(
    `дней ${claims.length}, одобрений ${approvalsTotal}, новых отказов ${denialsTotal}, ` +
      `дней без покрытия ${missing}`,
  )

  return {
    itemsProcessed: claims.length,
    meta: { days: claims.length, approvals: approvalsTotal, denialsNew: denialsTotal, missing },
  }
}
