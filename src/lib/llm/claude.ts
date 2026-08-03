import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv } from '../env'
import { buildSchema, buildStablePrefix, parseEnrichPayload, PROMPT_VERSION } from './prompt'
import type { EnrichInput, EnrichResult, ReasonEnricher } from './types'

/**
 * Denial reason enrichment via Claude.
 *
 * Model quirks accounted for here:
 *
 *  - On claude-opus-5, thinking is enabled BY DEFAULT, and `max_tokens`
 *    caps thinking together with the response text. Hence the 8000
 *    headroom: with a tight limit the response would get cut off mid-JSON.
 *  - `temperature`/`top_p`/`top_k` return 400 on this model: they're
 *    intentionally absent here.
 *  - A refusal arrives as a successful HTTP 200 with
 *    `stop_reason: "refusal"`, so the status is checked BEFORE reading
 *    content: accessing content[0] on a refusal would throw.
 *  - The stable part of the prompt (the list of known reasons and
 *    categories) is cached. The cache is a prefix match, so the
 *    changing remainder of the text goes into the user message, not
 *    system.
 */

const DEFAULT_MODEL = 'claude-opus-5'

/**
 * What we actually read from the response. Declared structurally because
 * the beta endpoint and the regular one return different nominal types,
 * but the fields needed here are shared between them.
 */
type MessageLike = {
  stop_reason: string | null
  stop_details?: { category?: string | null } | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number | null
  }
  content: { type: string; text?: string }[]
}

export class ClaudeEnricher implements ReasonEnricher {
  readonly name = 'claude'
  readonly model: string
  readonly promptVersion = PROMPT_VERSION

  private readonly client: Anthropic
  /** Turned off if the server rejected the fallback beta parameter. */
  private serverFallbackEnabled = true

  constructor(options: { apiKey?: string; model?: string } = {}) {
    // Model is set via a provider-specific variable: a shared LLM_MODEL
    // would leak into the wrong provider's API on a switch and 404 there.
    this.model = options.model ?? optionalEnv('LLM_MODEL_CLAUDE') ?? DEFAULT_MODEL
    // The client retries 429 and 5xx on its own with exponential backoff.
    this.client = new Anthropic({
      apiKey: options.apiKey ?? optionalEnv('ANTHROPIC_API_KEY'),
      maxRetries: 3,
    })
  }

  async enrich(input: EnrichInput): Promise<EnrichResult> {
    const remainder = input.remainder.trim()
    const base: Pick<EnrichResult, 'model' | 'promptVersion'> = {
      model: this.model,
      promptVersion: this.promptVersion,
    }

    if (remainder.length === 0) {
      return { matchedSlugs: [], newReasons: [], needsReview: false, ...base }
    }

    const categoryCodes = input.categories.map((c) => c.code)
    const knownSlugs = input.known.map((k) => k.slug)

    // Stable prefix: instructions + reference lists. The changing
    // remainder goes into the user message, otherwise the cache wouldn't
    // be reused.
    const stablePrefix = buildStablePrefix(input)

    try {
      const response = await this.request(stablePrefix, remainder, categoryCodes, knownSlugs)

      // A refusal arrives as a successful response. Check before reading content.
      if (response.stop_reason === 'refusal') {
        return {
          matchedSlugs: [],
          newReasons: [],
          needsReview: true,
          reviewReason: `model refused the request (${response.stop_details?.category ?? 'no category'})`,
          ...base,
        }
      }

      if (response.stop_reason === 'max_tokens') {
        return {
          matchedSlugs: [],
          newReasons: [],
          needsReview: true,
          reviewReason: 'response truncated at max_tokens',
          ...base,
        }
      }

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      }

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')

      const parsed = parseEnrichPayload(text, categoryCodes, knownSlugs)
      if (parsed === null) {
        return {
          matchedSlugs: [],
          newReasons: [],
          needsReview: true,
          reviewReason: "response doesn't match the schema",
          usage,
          ...base,
        }
      }

      return { ...parsed, needsReview: false, usage, ...base }
    } catch (error) {
      return {
        matchedSlugs: [],
        newReasons: [],
        needsReview: true,
        reviewReason: describeError(error),
        ...base,
      }
    }
  }

  private async request(
    stablePrefix: string,
    remainder: string,
    categoryCodes: readonly string[],
    knownSlugs: readonly string[],
  ): Promise<MessageLike> {
    const params = {
      model: this.model,
      // Thinking is enabled by default on this model and shares
      // max_tokens with the response, so headroom is mandatory.
      max_tokens: 8000,
      output_config: {
        // The task is a classification task: low effort gives the
        // needed quality noticeably cheaper. Thinking is NOT disabled,
        // though: disabling it has its own edge-case defects on opus-5.
        effort: 'low' as const,
        format: {
          type: 'json_schema' as const,
          schema: buildSchema(categoryCodes, knownSlugs),
        },
      },
      system: [
        {
          type: 'text' as const,
          text: stablePrefix,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: `Trecho:\n${remainder}` }],
    }

    if (!this.serverFallbackEnabled) {
      return (await this.client.messages.create(params)) as MessageLike
    }

    try {
      // The model's classifiers can refuse a request; server-side
      // fallback replays it on a different model within the same call.
      const response = await this.client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Parameters<typeof this.client.beta.messages.create>[0])
      return response as MessageLike
    } catch (error) {
      if (error instanceof Anthropic.BadRequestError && /fallback/i.test(error.message)) {
        // The parameter isn't accepted for this account or model, so fall back to without it.
        this.serverFallbackEnabled = false
        return (await this.client.messages.create(params)) as MessageLike
      }
      throw error
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return 'rate limit exceeded'
  if (error instanceof Anthropic.AuthenticationError) return 'invalid or missing key'
  if (error instanceof Anthropic.PermissionDeniedError) return 'no access to the model'
  if (error instanceof Anthropic.NotFoundError) return 'model not found'
  // APIConnectionError is checked before APIError: in this SDK it's a subclass of it.
  if (error instanceof Anthropic.APIConnectionError) return 'network unavailable'
  if (error instanceof Anthropic.APIError) return `API error ${error.status ?? '?'}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}
