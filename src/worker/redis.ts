import IORedis from 'ioredis'

/**
 * BullMQ требует отдельное соединение на каждый блокирующий потребитель
 * (Worker) и maxRetriesPerRequest: null — иначе брошенные BRPOP-запросы
 * рвут воркер.
 */
export function createRedis(name: string): IORedis {
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error('REDIS_URL не задан. Скопируйте .env.example в .env.')
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
