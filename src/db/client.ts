import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * The pool and the drizzle instance are created lazily, on first use.
 *
 * This matters for the build: `next build` imports route modules to collect
 * metadata about them. If the pool were created at module top level, the
 * build would require DATABASE_URL, which isn't and shouldn't be available
 * at build time in the Docker image.
 */
function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')
  }

  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // Don't keep idle connections alive longer than 30s.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
}

// In dev mode Next.js reloads modules. Without a globalThis cache,
// every HMR reload would create a new connection pool.
const globalForDb = globalThis as unknown as {
  __douPool?: Pool
  __douDb?: NodePgDatabase<typeof schema>
}

export function getPool(): Pool {
  globalForDb.__douPool ??= createPool()
  return globalForDb.__douPool
}

function getDb(): NodePgDatabase<typeof schema> {
  globalForDb.__douDb ??= drizzle(getPool(), { schema })
  return globalForDb.__douDb
}

/** Closes the pool. Needed by scripts (migrations, seed) and by the worker on shutdown. */
export async function closePool(): Promise<void> {
  const pool = globalForDb.__douPool
  if (!pool) return
  globalForDb.__douPool = undefined
  globalForDb.__douDb = undefined
  await pool.end()
}

/**
 * The regular drizzle interface, but the connection opens on first access.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, property, receiver) {
    const instance = getDb()
    const value = Reflect.get(instance, property, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

export { schema }
