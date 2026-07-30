/**
 * Применяет SQL-миграции из ./drizzle.
 * Запускается отдельным сервисом migrate в docker compose до web и worker.
 */
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { closePool, db } from './client'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

try {
  // Расширения создаются до миграций: GIN-индексы по gin_trgm_ops
  // и нормализация имён без них не создадутся.
  console.log('[migrate] включаю расширения pg_trgm и unaccent')
  await db.execute(sql`create extension if not exists pg_trgm`)
  await db.execute(sql`create extension if not exists unaccent`)

  console.log(`[migrate] применяю миграции из ${migrationsFolder}`)
  await migrate(db, { migrationsFolder })
  console.log('[migrate] готово')
} catch (error) {
  console.error('[migrate] ошибка:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
