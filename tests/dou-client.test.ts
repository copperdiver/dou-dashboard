import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { describeFetchError } from '../src/lib/dou/client'

/**
 * Сообщение об ошибке сети — единственное, что видно на странице
 * состояния и в `ingest_days.last_error`. Если оно теряет причину,
 * недоступность источника не отличить от отказа прокси.
 */
describe('describeFetchError', () => {
  it('берёт код из причины, а не только текст обёртки', () => {
    const error = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
    assert.equal(describeFetchError(error), 'fetch failed: ECONNREFUSED')
  })

  it('разворачивает вложенную причину: отказ прокси виден целиком', () => {
    // Так undici сообщает о прокси, закрывшем домен на стадии CONNECT.
    const error = new TypeError('fetch failed', {
      cause: new Error('Request was cancelled.', {
        cause: new Error('Proxy response (403) !== 200 when HTTP Tunneling'),
      }),
    })

    const message = describeFetchError(error)

    assert.match(message, /Proxy response \(403\)/)
    assert.match(message, /Request was cancelled/)
  })

  it('не повторяет одинаковые сообщения в цепочке', () => {
    const error = new TypeError('fetch failed', {
      cause: new Error('одно и то же', { cause: new Error('одно и то же') }),
    })
    assert.equal(describeFetchError(error), 'fetch failed: одно и то же')
  })

  it('переживает закольцованную причину', () => {
    const inner = new Error('внутренняя') as Error & { cause?: unknown }
    const outer = new TypeError('fetch failed', { cause: inner })
    inner.cause = outer

    assert.equal(describeFetchError(outer), 'fetch failed: внутренняя ← fetch failed')
  })

  it('таймаут называет таймаутом, а не отменой', () => {
    const error = new Error('This operation was aborted')
    error.name = 'AbortError'
    assert.equal(describeFetchError(error), 'таймаут запроса')
  })

  it('не падает на том, что ошибкой не является', () => {
    assert.equal(describeFetchError('строка'), 'строка')
  })
})
