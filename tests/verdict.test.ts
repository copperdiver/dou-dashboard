import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { sourceVerdict } from '../src/lib/dou/verdict'
import type { DouStatus } from '../src/lib/queries/dou-status'

/**
 * The verdict is the one line on the status page that gets acted on, and
 * the failure mode that matters is a red state that never clears: after
 * a while nobody reads it, and a real outage arrives looking exactly the
 * same as the stale one.
 */

/** A healthy pipeline. Each test changes only what it is about. */
function status(overrides: Partial<DouStatus> = {}): DouStatus {
  return {
    cooldownMs: 0,
    forbiddenStreak: 0,
    budget: { used: 120, limit: 5000 },
    lastSuccessAt: '2026-08-04T06:00:02-03:00',
    lastFailure: null,
    failedDays: 0,
    pendingPages: 0,
    probe: null,
    redisAvailable: true,
    viaProxy: false,
    ...overrides,
  }
}

describe('sourceVerdict', () => {
  it('is ok when nothing is pending', () => {
    assert.equal(sourceVerdict(status()), 'ok')
  })

  it('is blocked only while the post-403 cooldown runs', () => {
    assert.equal(sourceVerdict(status({ cooldownMs: 90_000 })), 'blocked')
    assert.equal(sourceVerdict(status({ cooldownMs: 0 })), 'ok')
  })

  /*
   * The regression. Two days died on network aborts over the weekend of
   * 2026-08-01, and `failed` is terminal until a manual reset. The panel
   * counted them as "source unreachable" and stayed red for days while
   * every fresh edition was being enumerated on schedule.
   */
  it('does not call the source unreachable over days awaiting a reset', () => {
    const verdict = sourceVerdict(status({ failedDays: 2 }))
    assert.notEqual(verdict, 'blocked')
    assert.equal(verdict, 'degraded')
  })

  it('reports the last error as degraded, not as an outage', () => {
    const verdict = sourceVerdict(
      status({ lastFailure: { day: '2026-08-02', error: 'fetch failed: UND_ERR_ABORTED', attempts: 5 } }),
    )
    assert.equal(verdict, 'degraded')
  })

  /*
   * A backfill spends the whole budget most days. That has to be visible,
   * because nothing more will be fetched today, but it is planned work
   * and must not read as an outage.
   */
  it('treats a spent daily budget as degraded, not blocked', () => {
    assert.equal(sourceVerdict(status({ budget: { used: 5000, limit: 5000 } })), 'degraded')
  })

  it('ignores the budget when no limit is configured', () => {
    assert.equal(sourceVerdict(status({ budget: { used: 0, limit: 0 } })), 'ok')
  })

  it('lets the cooldown outrank a backlog: the blocking condition wins', () => {
    assert.equal(sourceVerdict(status({ cooldownMs: 5_000, failedDays: 3 })), 'blocked')
  })

  /*
   * An unreachable Redis reports a zero cooldown and a zero budget, which
   * is exactly the shape of a healthy pipeline. Answering "ok" there would
   * be reading evidence out of an absence of data.
   */
  it('refuses to report ok when Redis is down', () => {
    assert.equal(sourceVerdict(status({ redisAvailable: false })), 'degraded')
  })
})
