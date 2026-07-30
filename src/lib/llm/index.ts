import { optionalEnv } from '../env'
import { ClaudeEnricher } from './claude'
import { NoopEnricher } from './noop'
import { OpenAIEnricher } from './openai'
import type { ReasonEnricher } from './types'

export type { EnrichInput, EnrichResult, ReasonCandidate, ReasonEnricher } from './types'
export { PROMPT_VERSION } from './prompt'

/**
 * Выбор провайдера обогащения.
 *
 * `LLM_PROVIDER=claude|openai|noop|auto` (по умолчанию auto).
 *
 * В режиме auto порядок предпочтения — claude, затем openai, затем
 * заглушка. Отсутствие ключей не останавливает конвейер: загрузка
 * и разбор от LLM не зависят, и падать из-за ненастроенного обогащения
 * они не должны.
 *
 * Явно указанный провайдер без ключа — это ошибка конфигурации, и она
 * сообщается сразу, а не подменяется тихо заглушкой: иначе можно долго
 * ждать переводов, которых никто не делает.
 */
export function createEnricher(): ReasonEnricher {
  const provider = (optionalEnv('LLM_PROVIDER') ?? 'auto').toLowerCase()

  // optionalEnv, а не Boolean: docker compose подставляет пустую строку
  // для незаданных переменных, и её нельзя считать заданным ключом.
  const hasAnthropicKey = optionalEnv('ANTHROPIC_API_KEY') !== undefined
  const hasOpenAIKey = optionalEnv('OPENAI_API_KEY') !== undefined

  switch (provider) {
    case 'noop':
      return new NoopEnricher()

    case 'claude':
    case 'anthropic':
      if (!hasAnthropicKey) throw new Error('LLM_PROVIDER=claude, но ANTHROPIC_API_KEY не задан')
      return new ClaudeEnricher()

    case 'openai':
      if (!hasOpenAIKey) throw new Error('LLM_PROVIDER=openai, но OPENAI_API_KEY не задан')
      return new OpenAIEnricher()

    case 'auto':
      if (hasAnthropicKey) return new ClaudeEnricher()
      if (hasOpenAIKey) return new OpenAIEnricher()
      return new NoopEnricher()

    default:
      throw new Error(
        `неизвестный LLM_PROVIDER=«${provider}»; допустимо: auto, claude, openai, noop`,
      )
  }
}
