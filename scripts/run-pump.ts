/**
 * Queues a pump off-schedule.
 *
 *   npm run pump -- enumerate
 *   npm run pump -- fetch --repeat=5
 *
 * Needed to avoid waiting for the cron tick while debugging, and to run
 * backfill faster than the usual pace. The pump itself doesn't care how
 * it was launched: it pulls work from Postgres, so an extra run is harmless.
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
      `Unknown pump "${name ?? ''}". Available: ${SCHEDULE.map((j) => j.name).join(', ')}`,
    )
    process.exitCode = 2
  } else {
    for (let i = 0; i < Math.max(1, repeat); i += 1) {
      await queues[job.queue].add(job.name, { manual: true })
    }
    console.log(`[pump] ${job.name} queued to ${job.queue} ×${Math.max(1, repeat)}`)
  }
} catch (error) {
  console.error('[pump] error:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await closeQueues()
}
