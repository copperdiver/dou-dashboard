import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * Пул и экземпляр drizzle создаются лениво, при первом запросе.
 *
 * Это важно для сборки: `next build` импортирует модули роутов, чтобы собрать
 * о них метаданные. Если бы пул создавался на верхнем уровне, сборка требовала
 * бы DATABASE_URL — в Docker-образе на этапе build его нет и быть не должно.
 */
function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL не задан. Скопируйте .env.example в .env.')
  }

  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // Не держим простаивающие соединения дольше 30 с.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
}

// В dev-режиме Next.js перезагружает модули — без кэша в globalThis
// на каждом HMR создавался бы новый пул соединений.
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

/** Закрывает пул. Нужно скриптам (миграции, seed) и воркеру при остановке. */
export async function closePool(): Promise<void> {
  const pool = globalForDb.__douPool
  if (!pool) return
  globalForDb.__douPool = undefined
  globalForDb.__douDb = undefined
  await pool.end()
}

/**
 * Обычный интерфейс drizzle, но подключение открывается при первом обращении.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, property, receiver) {
    const instance = getDb()
    const value = Reflect.get(instance, property, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

export { schema }
