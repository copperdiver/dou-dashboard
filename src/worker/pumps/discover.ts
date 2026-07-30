import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { ingestDays } from '../../db/schema'
import { douConfig, pipelineConfig } from '../../lib/env'
import type { Pump } from './types'

/**
 * Ставит в очередь дни, которые ещё не опрашивались.
 *
 * Смотрит назад на несколько дней, а не только на сегодня: DOU публикует
 * с задержкой и правит выпуски задним числом. Повторный запуск безопасен —
 * существующие строки не трогаются, поэтому уже разобранный день не
 * сбрасывается в pending.
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
      // Приоритет 0: свежие дни никогда не ждут, пока дожуётся бэкфилл.
      priority: 0,
    })),
  )

  const inserted = await db
    .insert(ingestDays)
    .values(rows)
    .onConflictDoNothing({ target: [ingestDays.editionDate, ingestDays.section] })
    .returning({ editionDate: ingestDays.editionDate, section: ingestDays.section })

  if (inserted.length > 0) {
    log(`добавлено дней: ${inserted.map((r) => `${r.editionDate}/${r.section}`).join(', ')}`)
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
