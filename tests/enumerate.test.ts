import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { isEditionDayOver } from '../src/worker/pumps/enumerate'

/**
 * An empty daily index closes the day for good, so the question of
 * whether "this day is over" decides whether we miss an edition or wait
 * for it. It must be computed in São Paulo time: with TZ=Europe/Moscow
 * the server rolls over to a new date six hours before Brazil does, and
 * in that window a fresh day used to get closed as "no edition" before
 * it was even published.
 */
describe('isEditionDayOver', () => {
  it('the day is still going: midnight in São Paulo, wait all day for the edition', () => {
    // 03:00 UTC = 00:00 in São Paulo on the same date.
    assert.equal(isEditionDayOver('2026-07-31', new Date('2026-07-31T03:00:00Z')), false)
  })

  it('the day is still going: late evening in São Paulo', () => {
    // 02:00 UTC the next day = 23:00 in São Paulo on the 31st.
    assert.equal(isEditionDayOver('2026-07-31', new Date('2026-08-01T02:00:00Z')), false)
  })

  it('the day is over: it is already the next date in São Paulo', () => {
    // 04:00 UTC = 01:00 in São Paulo on August 1st.
    assert.equal(isEditionDayOver('2026-07-31', new Date('2026-08-01T04:00:00Z')), true)
  })

  it('midnight in Moscow does not count as the end of the Brazilian day', () => {
    // 21:00 UTC = 00:00 in Moscow on August 1st, but it's still 18:00 on the
    // 31st in São Paulo. This exact offset is what used to lose fresh editions.
    assert.equal(isEditionDayOver('2026-07-31', new Date('2026-07-31T21:00:00Z')), false)
  })

  it('a long-past day closes immediately', () => {
    assert.equal(isEditionDayOver('2025-01-15', new Date('2026-07-31T12:00:00Z')), true)
  })
})
