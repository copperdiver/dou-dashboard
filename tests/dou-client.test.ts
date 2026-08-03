import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { describeFetchError } from '../src/lib/dou/client'

/**
 * The network error message is the only thing visible on the status
 * page and in `ingest_days.last_error`. If it loses the cause, source
 * unavailability becomes indistinguishable from a proxy failure.
 */
describe('describeFetchError', () => {
  it('takes the code from the cause, not just the wrapper text', () => {
    const error = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
    assert.equal(describeFetchError(error), 'fetch failed: ECONNREFUSED')
  })

  it('unwraps a nested cause: the proxy failure is fully visible', () => {
    // This is how undici reports a proxy that closed the domain at the CONNECT stage.
    const error = new TypeError('fetch failed', {
      cause: new Error('Request was cancelled.', {
        cause: new Error('Proxy response (403) !== 200 when HTTP Tunneling'),
      }),
    })

    const message = describeFetchError(error)

    assert.match(message, /Proxy response \(403\)/)
    assert.match(message, /Request was cancelled/)
  })

  it('does not repeat identical messages in the chain', () => {
    const error = new TypeError('fetch failed', {
      cause: new Error('same message', { cause: new Error('same message') }),
    })
    assert.equal(describeFetchError(error), 'fetch failed: same message')
  })

  it('survives a circular cause', () => {
    const inner = new Error('internal') as Error & { cause?: unknown }
    const outer = new TypeError('fetch failed', { cause: inner })
    inner.cause = outer

    assert.equal(describeFetchError(outer), 'fetch failed: internal ← fetch failed')
  })

  it('calls a timeout a timeout, not a cancellation', () => {
    const error = new Error('This operation was aborted')
    error.name = 'AbortError'
    assert.equal(describeFetchError(error), 'request timeout')
  })

  it('does not crash on something that is not an error', () => {
    assert.equal(describeFetchError('a string'), 'a string')
  })
})
