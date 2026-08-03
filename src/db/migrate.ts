/**
 * Applies SQL migrations from ./drizzle.
 * Runs as a separate migrate service in docker compose, before web and worker.
 */
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { closePool, db } from './client'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

try {
  // Extensions are created before migrations: GIN indexes on gin_trgm_ops
  // and name normalization won't work without them.
  console.log('[migrate] enabling pg_trgm and unaccent extensions')
  await db.execute(sql`create extension if not exists pg_trgm`)
  await db.execute(sql`create extension if not exists unaccent`)

  console.log(`[migrate] applying migrations from ${migrationsFolder}`)
  await migrate(db, { migrationsFolder })
  console.log('[migrate] done')
} catch (error) {
  console.error('[migrate] error:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
