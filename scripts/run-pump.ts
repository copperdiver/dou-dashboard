/**
 * Ставит насос в очередь вне расписания.
 *
 *   npm run pump -- enumerate
 *   npm run pump -- fetch --repeat=5
 *
 * Нужно, чтобы не ждать тика крона при отладке и чтобы прогнать бэкфилл
 * быстрее обычного темпа. Сам насос от способа запуска не зависит:
 * работу он берёт из Postgres, поэтому лишний запуск безвреден.
 */
import { SCHEDULE } from '../src/worker/jobs'
import { closeQueues, queues } from '../src/worker/queue'

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

const name = process.argv.slice(2).find((a) => !a.startsWith('--'))
const repeat = Number.parseInt(arg('repeat') ?? '1', 10)

try {
  const job = SCHEDULE.find((j) => j.name === name)

  if (!job) {
    console.error(
      `Неизвестный насос «${name ?? ''}». Доступны: ${SCHEDULE.map((j) => j.name).join(', ')}`,
    )
    process.exitCode = 2
  } else {
    for (let i = 0; i < Math.max(1, repeat); i += 1) {
      await queues[job.queue].add(job.name, { manual: true })
    }
    console.log(`[pump] ${job.name} поставлен в очередь ${job.queue} ×${Math.max(1, repeat)}`)
  }
} catch (error) {
  console.error('[pump] ошибка:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await closeQueues()
}
