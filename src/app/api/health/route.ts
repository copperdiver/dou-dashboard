import { sql } from 'drizzle-orm'
import { db } from '@/db/client'

export const dynamic = 'force-dynamic'

/** Healthcheck for docker compose: verifies the process is alive and the DB responds. */
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
