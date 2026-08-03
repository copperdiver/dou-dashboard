import IORedis from 'ioredis'

/**
 * BullMQ requires a separate connection per blocking consumer (Worker)
 * and maxRetriesPerRequest: null, otherwise abandoned BRPOP requests
 * break the worker.
 */
export function createRedis(name: string): IORedis {
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error('REDIS_URL is not set. Copy .env.example to .env.')
  }

  const connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: `dou-${name}`,
  })

  connection.on('error', (error: Error) => {
    console.error(`[redis:${name}]`, error.message)
  })

  return connection
}
