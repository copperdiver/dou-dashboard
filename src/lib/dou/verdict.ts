import type { DouStatus } from '../queries/dou-status'

/**
 * The one-word verdict on the status page.
 *
 * Kept out of the panel and given a test because the rule is read at a
 * glance and acted on, and it got this wrong once already: failed days
 * counted as "unreachable", and since a failed day is terminal until a
 * manual reset, one bad afternoon pinned the panel to red for good while
 * the pumps went on enumerating fresh editions right next to it. An
 * alarm that never clears stops being read at all, so every input here
 * has to be something that is true *now*, not something that once was.
 */
export type SourceVerdict = 'blocked' | 'degraded' | 'ok'

export function sourceVerdict(status: DouStatus): SourceVerdict {
  // The post-403 cooldown is the only state in which not one request
  // leaves the client: the source refused us and set the clock itself.
  if (status.cooldownMs > 0) return 'blocked'

  // Everything below still lets work through, but wants a human eventually.
  // A spent budget belongs here rather than in red: during a backfill it
  // runs out most days by design, and calling that an outage would bring
  // the same false alarm back from the other side.
  const budgetSpent = status.budget.limit > 0 && status.budget.used >= status.budget.limit
  if (status.lastFailure !== null || status.failedDays > 0 || budgetSpent) return 'degraded'

  // Cooldown and budget both come from Redis, and an unreachable Redis
  // reports them as zero — the same shape a healthy pipeline has. So a
  // green verdict here would be built out of missing data rather than
  // evidence, and we say "don't know" instead. The panel spells out which
  // piece is missing in its own row.
  if (!status.redisAvailable) return 'degraded'

  return 'ok'
}
