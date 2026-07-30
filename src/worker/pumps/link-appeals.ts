import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { denials, dirtyDays } from '../../db/schema'
import type { Pump } from './types'

/**
 * Связывает подтверждения отказа с первичными решениями и помечает
 * повторные публикации.
 *
 * Обе величины нужны, чтобы статистика не считала одно решение дважды:
 *
 *  - `is_upheld` (`Manutenção de Indeferimento`) — подтверждение прежнего
 *    отказа при обжаловании. `appeal_of_id` показывает, какого именно.
 *  - `is_republication` — то же решение по тому же процессу, уже
 *    опубликованное раньше. Наблюдалось: процесс 235881.0729052/2026
 *    вышел как `indeferimento` 24, 27 и 29 июля.
 *
 * Пересчёт полный, а не инкрементальный: связь зависит от ВСЕЙ истории
 * (первичное решение могло быть опубликовано за месяцы до подтверждения),
 * а объём — десятки тысяч строк, то есть считается дешевле, чем стоило бы
 * отслеживать зависимости. В `dirty_days` попадают только дни, где
 * значение реально изменилось, иначе rollup молотил бы всю историю
 * на каждом тике.
 */

/**
 * Связь только по номеру процесса. Сопоставление по имени сознательно
 * не делается: тёзки в выборке на 837 блоков уже встречались, и ложная
 * связь между отказами разных людей хуже отсутствующей связи.
 */
async function linkAppeals(): Promise<string[]> {
  const result = await db.execute<{ edition_date: string }>(sql`
    update ${denials} d
       set appeal_of_id = p.primary_id,
           appeal_link_method = 'process'
      from (
        select u.id as upheld_id,
               (
                 select pr.id
                   from ${denials} pr
                  where pr.process_number_norm = u.process_number_norm
                    and pr.retired_at is null
                    and not pr.is_upheld
                    and pr.decision_kind = 'denial'
                    and pr.edition_date <= u.edition_date
                    and pr.id <> u.id
                  order by pr.edition_date desc, pr.block_ordinal desc
                  limit 1
               ) as primary_id
          from ${denials} u
         where u.retired_at is null
           and u.is_upheld
           and u.process_number_norm is not null
      ) p
     where d.id = p.upheld_id
       and p.primary_id is not null
       and d.appeal_of_id is distinct from p.primary_id
    returning d.edition_date
  `)

  return result.rows.map((r) => r.edition_date)
}

/**
 * Повторная публикация: то же решение по тому же процессу, вышедшее ранее.
 *
 * Раздел включает `is_upheld`: без него подтверждение отказа считалось бы
 * повторной публикацией первичного решения, хотя это разные решения
 * с одинаковым `decision_kind`.
 */
async function markRepublications(): Promise<string[]> {
  const result = await db.execute<{ edition_date: string }>(sql`
    with ranked as (
      select id,
             row_number() over (
               partition by process_number_norm, decision_kind, is_upheld
               order by edition_date, block_ordinal, id
             ) as seq
        from ${denials}
       where retired_at is null
         and process_number_norm is not null
    )
    update ${denials} d
       set is_republication = (r.seq > 1)
      from ranked r
     where d.id = r.id
       and d.is_republication is distinct from (r.seq > 1)
    returning d.edition_date
  `)

  return result.rows.map((r) => r.edition_date)
}

/**
 * Пересчёт материализованного флага «считается новым отказом».
 *
 * Определение живёт здесь и в парсере одним выражением. Держать его
 * материализованным, а не вычислять в каждом запросе, — сознательный
 * выбор: иначе условие размазалось бы по всем витринам и фидам.
 */
async function recomputeCounts(): Promise<string[]> {
  const result = await db.execute<{ edition_date: string }>(sql`
    update ${denials} d
       set counts_as_new_denial = expected.value
      from (
        select id,
               (
                 decision_kind = 'denial'
                 and not is_upheld
                 and subject_kind = 'naturalization'
                 and not is_republication
               ) as value
          from ${denials}
         where retired_at is null
      ) expected
     where d.id = expected.id
       and d.counts_as_new_denial is distinct from expected.value
    returning d.edition_date
  `)

  return result.rows.map((r) => r.edition_date)
}

export const linkAppealsAndRepublications: Pump = async ({ log }) => {
  const republications = await markRepublications()
  const appeals = await linkAppeals()
  // Порядок важен: флаг «нового отказа» зависит от is_republication,
  // поэтому пересчитывается последним.
  const counts = await recomputeCounts()

  const touchedDays = [...new Set([...republications, ...appeals, ...counts])]

  if (touchedDays.length > 0) {
    await db
      .insert(dirtyDays)
      .values(touchedDays.map((day) => ({ day, reason: 'link-appeals' })))
      .onConflictDoUpdate({
        target: dirtyDays.day,
        set: { reason: sql`'link-appeals'`, markedAt: sql`now()` },
      })
  }

  // Сколько подтверждений так и осталось без первичного решения —
  // это НЕ ошибка: первичный отказ мог выйти до начала наблюдения.
  // На 20 подряд идущих днях ни одно из 31 подтверждения не имело
  // первичного решения в окне.
  const [orphans] = await db
    .execute<{ orphans: number; upheld: number }>(sql`
      select
        count(*) filter (where appeal_of_id is null)::int as orphans,
        count(*)::int                                     as upheld
        from ${denials}
       where retired_at is null and is_upheld
    `)
    .then((r) => r.rows)

  log(
    `повторных публикаций изменено ${republications.length}, ` +
      `апелляций связано ${appeals.length}, флагов пересчитано ${counts.length}, ` +
      `подтверждений без первичного решения ${orphans?.orphans ?? 0} из ${orphans?.upheld ?? 0}`,
  )

  return {
    itemsProcessed: touchedDays.length,
    meta: {
      republications: republications.length,
      appealsLinked: appeals.length,
      countsRecomputed: counts.length,
      daysMarked: touchedDays.length,
      upheldTotal: orphans?.upheld ?? 0,
      upheldWithoutPrimary: orphans?.orphans ?? 0,
    },
  }
}
