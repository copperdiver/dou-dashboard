/**
 * Засеивает ingest_days историей, чтобы насосы разобрали её сами.
 *
 *   npm run backfill                      # год назад от сегодня
 *   npm run backfill -- --days=90
 *   npm run backfill -- --from=2025-08-01 --to=2026-07-29
 *
 * Отдельного конвейера для бэкфилла нет и не нужно: тот же код разбора,
 * различие только в origin (для отчётности) и priority — насос берёт
 * `order by priority, edition_date desc`, поэтому свежий день никогда
 * не ждёт, пока дожуётся история.
 *
 * Повторный запуск безопасен: уже опрошенные дни не сбрасываются.
 */
import { sql } from 'drizzle-orm'
import { closePool, db } from '../src/db/client'
import { ingestDays } from '../src/db/schema'
import { douConfig, pipelineConfig } from '../src/lib/env'

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} должно быть в формате YYYY-MM-DD, получено «${value}»`)
  }
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) throw new Error(`${label}: недопустимая дата «${value}»`)
  return d
}

try {
  const { sections } = douConfig()
  const { backfillDays } = pipelineConfig()

  const to = arg('to') ? parseDate(arg('to')!, '--to') : new Date()
  const days = arg('days') ? Number.parseInt(arg('days')!, 10) : backfillDays

  let from: Date
  if (arg('from')) {
    from = parseDate(arg('from')!, '--from')
  } else {
    from = new Date(to)
    from.setUTCDate(from.getUTCDate() - (days - 1))
  }

  if (from > to) throw new Error('--from позже --to')

  const rows: { editionDate: string; section: string; status: 'pending'; origin: 'backfill'; priority: number }[] = []
  let weekends = 0

  for (const cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    // Выходные пропускаем: DOU по субботам и воскресеньям обычного выпуска
    // не даёт, и опрашивать их — чистые 250+ лишних запросов на год.
    // Дополнительные выпуски по будням при этом не теряются.
    const weekday = cursor.getUTCDay()
    if (weekday === 0 || weekday === 6) {
      weekends += 1
      continue
    }

    for (const section of sections) {
      rows.push({
        editionDate: isoDate(cursor),
        section,
        status: 'pending',
        origin: 'backfill',
        // Ниже свежих дней (priority 0): история ждёт, инкремент — нет.
        priority: 100,
      })
    }
  }

  const inserted = await db
    .insert(ingestDays)
    .values(rows)
    .onConflictDoNothing({ target: [ingestDays.editionDate, ingestDays.section] })
    .returning({ editionDate: ingestDays.editionDate })

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ingestDays)
    .where(sql`${ingestDays.status} = 'pending'`)

  console.log(
    `[backfill] период ${isoDate(from)} … ${isoDate(to)}: ` +
      `будних дней ${rows.length}, пропущено выходных ${weekends}, ` +
      `добавлено новых ${inserted.length}, уже было ${rows.length - inserted.length}`,
  )
  console.log(`[backfill] всего ожидает опроса: ${pending?.count ?? 0}`)
  console.log('[backfill] дальше их разберут насосы enumerate и fetch')
} catch (error) {
  console.error('[backfill] ошибка:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await closePool()
}
