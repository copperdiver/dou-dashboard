import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { ingestDaySnapshots, ingestDays, sourcePages } from '../../db/schema'
import { articleUrl, dailyIndexUrl } from '../../lib/dou/client'
import { parseDailyIndex, parsePubDate, selectRelevant } from '../../lib/dou/daily-index'
import { pipelineConfig } from '../../lib/env'
import { sha256Hex } from '../../lib/text'
import type { Pump, PumpContext } from './types'

type Claim = {
  editionDate: string
  section: string
  attempts: number
}

/**
 * Забирает пачку дней в работу.
 *
 * `for update skip locked` плюс аренда через next_attempt_at: если процесс
 * упадёт, строка не останется в running навсегда — по истечении аренды её
 * можно взять заново. Это и делает прогресс бэкфилла на 250 дней
 * восстанавливаемым без участия Redis.
 */
async function claimDays(limit: number, leaseMs: number): Promise<Claim[]> {
  const result = await db.execute<Claim>(sql`
    with claimed as (
      select edition_date, section
      from ${ingestDays}
      -- pending с истёкшим backoff либо running с истёкшей арендой.
      -- failed не берём: это терминальное состояние до ручного сброса,
      -- иначе окончательно упавший день ретраился бы вечно.
      where status in ('pending', 'running')
        and (next_attempt_at is null or next_attempt_at < now())
      order by priority, edition_date desc
      limit ${limit}
      for update skip locked
    )
    update ${ingestDays} d
       set status = 'running',
           attempts = d.attempts + 1,
           started_at = now(),
           next_attempt_at = now() + make_interval(secs => ${Math.round(leaseMs / 1000)})
      from claimed c
     where d.edition_date = c.edition_date
       and d.section = c.section
    returning d.edition_date as "editionDate", d.section, d.attempts
  `)

  return result.rows
}

async function markFailure(
  claim: Claim,
  message: string,
  maxAttempts: number,
): Promise<'retry' | 'failed'> {
  const giveUp = claim.attempts >= maxAttempts
  // Экспонента от номера попытки, потолок — час.
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, claim.attempts - 1))

  await db.execute(sql`
    update ${ingestDays}
       set status = ${giveUp ? 'failed' : 'pending'},
           last_error = ${message.slice(0, 1000)},
           next_attempt_at = ${giveUp ? null : sql`now() + make_interval(secs => ${delaySeconds})`}
     where edition_date = ${claim.editionDate}
       and section = ${claim.section}
  `)

  return giveUp ? 'failed' : 'retry'
}

/**
 * Тянет дневной индекс, сохраняет снапшот и апсертит релевантные статьи.
 *
 * Снапшот сырого jsonArray хранится всегда: он позволяет позже расширить
 * фильтр релевантности и переразобрать историю, не обращаясь к сети.
 */
export const enumerate: Pump = async ({ log, client }: PumpContext) => {
  const { enumerateBatch, maxAttempts, claimLeaseMs } = pipelineConfig()

  const cooldown = await client.cooldownRemainingMs()
  if (cooldown > 0) {
    log(`пауза источника ещё ${Math.ceil(cooldown / 1000)} с — пропускаю`)
    return { itemsProcessed: 0, meta: { skipped: 'cooldown' }, cooldownMs: cooldown }
  }

  const claims = await claimDays(enumerateBatch, claimLeaseMs)
  if (claims.length === 0) return { itemsProcessed: 0, meta: { days: 0 } }

  let daysDone = 0
  let pagesUpserted = 0
  let noEdition = 0
  let failures = 0
  let schemaMismatch = 0

  for (const claim of claims) {
    const url = dailyIndexUrl(claim.editionDate, claim.section)
    const response = await client.get(url)

    if (response.kind === 'budget_exhausted') {
      log(`суточный бюджет запросов исчерпан (${response.used}/${response.limit})`)
      await markFailure(claim, 'суточный бюджет запросов исчерпан', maxAttempts)
      return {
        itemsProcessed: daysDone,
        meta: { days: daysDone, pages: pagesUpserted, budgetExhausted: true },
      }
    }

    if (response.kind === 'forbidden') {
      log(`403 от источника, пауза ${Math.round(response.cooldownMs / 1000)} с`)
      await markFailure(claim, `HTTP ${response.status} (WAF)`, maxAttempts)
      return {
        itemsProcessed: daysDone,
        meta: { days: daysDone, pages: pagesUpserted, http403: true },
        cooldownMs: response.cooldownMs,
      }
    }

    if (response.kind === 'gone') {
      // Выпуска за этот день не существует — это не сбой.
      await db.execute(sql`
        update ${ingestDays}
           set status = 'no_edition', articles_found = 0, relevant_found = 0,
               next_attempt_at = null, completed_at = now(), last_error = null
         where edition_date = ${claim.editionDate} and section = ${claim.section}
      `)
      noEdition += 1
      continue
    }

    if (response.kind === 'transient') {
      failures += 1
      const outcome = await markFailure(claim, response.message, maxAttempts)
      log(`${claim.editionDate}: ${response.message} → ${outcome}`)
      continue
    }

    const index = parseDailyIndex(response.body)

    if (index === null) {
      // 200, но нет <script id="params"> — вёрстка изменилась. Это главный
      // сигнал «источник сломался», и глушить его ретраями нельзя.
      schemaMismatch += 1
      await db.execute(sql`
        update ${ingestDays}
           set status = 'failed',
               last_error = 'разметка изменилась: нет script#params',
               next_attempt_at = null
         where edition_date = ${claim.editionDate} and section = ${claim.section}
      `)
      log(`${claim.editionDate}: РАЗМЕТКА ИЗМЕНИЛАСЬ — нет script#params`)
      continue
    }

    if (index.items.length === 0) {
      await db.execute(sql`
        update ${ingestDays}
           set status = 'no_edition', articles_found = 0, relevant_found = 0,
               next_attempt_at = null, completed_at = now(), last_error = null
         where edition_date = ${claim.editionDate} and section = ${claim.section}
      `)
      noEdition += 1
      continue
    }

    const relevant = selectRelevant(index.items)

    await db
      .insert(ingestDaySnapshots)
      .values({
        editionDate: claim.editionDate,
        section: claim.section,
        jsonRaw: JSON.stringify(index.items),
        sha256: sha256Hex(JSON.stringify(index.items)),
      })
      .onConflictDoUpdate({
        target: [ingestDaySnapshots.editionDate, ingestDaySnapshots.section],
        set: {
          jsonRaw: sql`excluded.json_raw`,
          sha256: sql`excluded.sha256`,
          fetchedAt: sql`now()`,
        },
      })

    if (relevant.length > 0) {
      const inserted = await db
        .insert(sourcePages)
        .values(
          relevant.map((item) => ({
            urlTitle: item.urlTitle,
            url: articleUrl(item.urlTitle),
            // Дата выпуска берётся из pubDate статьи, а не из опрашиваемого
            // дня: они расходятся (акт от 28 июля печатается 29-го).
            editionDate: parsePubDate(item.pubDate) ?? claim.editionDate,
            section: claim.section,
            editionNumber: item.editionNumber,
            pageNumber: item.numberPage,
            artType: item.artType,
            pubOrder: item.pubOrder,
            hierarchyStr: item.hierarchyStr,
            title: item.title,
            selectedBy: item.selectedBy,
          })),
        )
        // Уже загруженную страницу не сбрасываем в pending: обновляем
        // только метаданные из индекса.
        .onConflictDoUpdate({
          target: sourcePages.urlTitle,
          set: {
            title: sql`excluded.title`,
            hierarchyStr: sql`excluded.hierarchy_str`,
            selectedBy: sql`excluded.selected_by`,
            editionNumber: sql`excluded.edition_number`,
            pageNumber: sql`excluded.page_number`,
            pubOrder: sql`excluded.pub_order`,
          },
        })
        .returning({ id: sourcePages.id })

      pagesUpserted += inserted.length
    }

    await db.execute(sql`
      update ${ingestDays}
         set status = 'enumerated',
             articles_found = ${index.items.length},
             relevant_found = ${relevant.length},
             next_attempt_at = null,
             completed_at = now(),
             last_error = null
       where edition_date = ${claim.editionDate} and section = ${claim.section}
    `)

    daysDone += 1
    log(`${claim.editionDate}: статей ${index.items.length}, релевантных ${relevant.length}`)
  }

  return {
    // Дни без выпуска — тоже обработанная работа: иначе метрика прогона
    // показывала бы ноль на пачке из одних выходных.
    itemsProcessed: daysDone + noEdition,
    meta: {
      days: daysDone,
      pages: pagesUpserted,
      noEdition,
      failures,
      schemaMismatch,
    },
  }
}
