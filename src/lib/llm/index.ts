import { ClaudeEnricher } from './claude'
import { NoopEnricher } from './noop'
import type { ReasonEnricher } from './types'

export type { EnrichInput, EnrichResult, ReasonCandidate, ReasonEnricher } from './types'

/**
 * Выбор провайдера обогащения.
 *
 * `LLM_PROVIDER=claude|noop|auto` (по умолчанию auto). В режиме auto
 * Claude используется только если задан ANTHROPIC_API_KEY — иначе
 * конвейер работает на заглушке, а не падает: отсутствие ключа не должно
 * останавливать загрузку и разбор.
 */
export function createEnricher(): ReasonEnricher {
  const provider = (process.env.LLM_PROVIDER ?? 'auto').toLowerCase()

  if (provider === 'noop') return new NoopEnricher()

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY)

  if (provider === 'claude') {
    if (!hasKey) {
      throw new Error('LLM_PROVIDER=claude, но ANTHROPIC_API_KEY не задан')
    }
    return new ClaudeEnricher()
  }

  return hasKey ? new ClaudeEnricher() : new NoopEnricher()
}
