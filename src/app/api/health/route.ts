import { sql } from 'drizzle-orm'
import { db } from '@/db/client'

export const dynamic = 'force-dynamic'

/** Healthcheck для docker compose: проверяет, что процесс жив и БД отвечает. */
export async function GET() {
  try {
    await db.execute(sql`select 1`)
    return Response.json({ status: 'ok', database: 'up' })
  } catch (error) {
    return Response.json(
      { status: 'degraded', database: 'down', error: (error as Error).message },
      { status: 503 },
    )
  }
}
