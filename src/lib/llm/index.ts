import { optionalEnv } from '../env'
import { ClaudeEnricher } from './claude'
import { NoopEnricher } from './noop'
import { OpenAIEnricher } from './openai'
import type { ReasonEnricher } from './types'

export type { EnrichInput, EnrichResult, ReasonCandidate, ReasonEnricher } from './types'
export { PROMPT_VERSION } from './prompt'

/**
 * Enrichment provider selection.
 *
 * `LLM_PROVIDER=claude|openai|noop|auto` (defaults to auto).
 *
 * In auto mode the preference order is claude, then openai, then the
 * no-op stub. Missing keys don't stop the pipeline: fetching and parsing
 * don't depend on the LLM, and they shouldn't fail just because
 * enrichment isn't configured.
 *
 * An explicitly chosen provider without a key is a configuration error,
 * and it's reported immediately rather than silently swapped for the
 * stub: otherwise you could wait a long time for translations nobody is
 * actually producing.
 */
export function createEnricher(): ReasonEnricher {
  const provider = (optionalEnv('LLM_PROVIDER') ?? 'auto').toLowerCase()

  // optionalEnv, not Boolean: docker compose substitutes an empty string
  // for unset variables, and that shouldn't count as a set key.
  const hasAnthropicKey = optionalEnv('ANTHROPIC_API_KEY') !== undefined
  const hasOpenAIKey = optionalEnv('OPENAI_API_KEY') !== undefined

  switch (provider) {
    case 'noop':
      return new NoopEnricher()

    case 'claude':
    case 'anthropic':
      if (!hasAnthropicKey) throw new Error('LLM_PROVIDER=claude, but ANTHROPIC_API_KEY is not set')
      return new ClaudeEnricher()

    case 'openai':
      if (!hasOpenAIKey) throw new Error('LLM_PROVIDER=openai, but OPENAI_API_KEY is not set')
      return new OpenAIEnricher()

    case 'auto':
      if (hasAnthropicKey) return new ClaudeEnricher()
      if (hasOpenAIKey) return new OpenAIEnricher()
      return new NoopEnricher()

    default:
      throw new Error(
        `unknown LLM_PROVIDER="${provider}"; allowed: auto, claude, openai, noop`,
      )
  }
}
