import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { ingestDays } from '../../db/schema'
import { douConfig, pipelineConfig } from '../../lib/env'
import type { Pump } from './types'

/**
 * Queues days that haven't been polled yet.
 *
 * Looks back several days, not just today: DOU publishes with a delay
 * and edits editions retroactively. Safe to re-run: existing rows are
 * left untouched, so an already-parsed day doesn't get reset to pending.
 */
export const discover: Pump = async ({ log }) => {
  const { discoverLookbackDays } = pipelineConfig()
  const { sections } = douConfig()

  const today = new Date()
  const days: string[] = []
  for (let offset = 0; offset < discoverLookbackDays; offset += 1) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - offset)
    days.push(d.toISOString().slice(0, 10))
  }

  const rows = days.flatMap((editionDate) =>
    sections.map((section) => ({
      editionDate,
      section,
      status: 'pending' as const,
      origin: 'incremental' as const,
      // Priority 0: fresh days never wait for the backfill to finish chewing through its queue.
      priority: 0,
    })),
  )

  const inserted = await db
    .insert(ingestDays)
    .values(rows)
    .onConflictDoNothing({ target: [ingestDays.editionDate, ingestDays.section] })
    .returning({ editionDate: ingestDays.editionDate, section: ingestDays.section })

  if (inserted.length > 0) {
    log(`days added: ${inserted.map((r) => `${r.editionDate}/${r.section}`).join(', ')}`)
  }

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ingestDays)
    .where(sql`${ingestDays.status} = 'pending'`)

  return {
    itemsProcessed: inserted.length,
    meta: { added: inserted.length, lookbackDays: discoverLookbackDays, pending: pending?.count ?? 0 },
  }
}
