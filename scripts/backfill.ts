/**
 * Seeds ingest_days with history so the pumps pick it up on their own.
 *
 *   npm run backfill                      # a year back from today
 *   npm run backfill -- --days=90
 *   npm run backfill -- --from=2025-08-01 --to=2026-07-29
 *
 * There's no separate pipeline for backfill, and there doesn't need to be:
 * same parsing code, the only difference is origin (for reporting) and
 * priority: the pump uses `order by priority, edition_date desc`, so a
 * fresh day never waits for history to finish chewing through.
 *
 * Safe to rerun: days already polled aren't reset.
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
    throw new Error(`${label} must be in YYYY-MM-DD format, got "${value}"`)
  }
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) throw new Error(`${label}: invalid date "${value}"`)
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

  if (from > to) throw new Error('--from is later than --to')

  const rows: { editionDate: string; section: string; status: 'pending'; origin: 'backfill'; priority: number }[] = []
  let weekends = 0

  for (const cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    // Skip weekends: DOU doesn't publish a regular edition on Saturdays and
    // Sundays, and polling them is a clean 250+ wasted requests per year.
    // Extra editions on weekdays aren't lost by this.
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
        // Below fresh days (priority 0): history waits, the incremental doesn't.
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
    `[backfill] period ${isoDate(from)} … ${isoDate(to)}: ` +
      `weekdays ${rows.length}, weekends skipped ${weekends}, ` +
      `new added ${inserted.length}, already existed ${rows.length - inserted.length}`,
  )
  console.log(`[backfill] total awaiting polling: ${pending?.count ?? 0}`)
  console.log('[backfill] the enumerate and fetch pumps will pick them up next')
} catch (error) {
  console.error('[backfill] error:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await closePool()
}
