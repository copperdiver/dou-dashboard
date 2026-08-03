import OpenAI from 'openai'
import { optionalEnv } from '../env'
import {
  buildSchema,
  buildStablePrefix,
  parseEnrichPayload,
  PROMPT_VERSION,
  SCHEMA_NAME,
} from './prompt'
import type { EnrichInput, EnrichResult, ReasonEnricher } from './types'

/**
 * Denial reason enrichment via OpenAI (Responses API).
 *
 * Quirks accounted for:
 *
 *  - `instructions` is rendered before `input`, so the stable part of
 *    the prompt goes there and the changing remainder goes into `input`.
 *    Prompt caching is prefix-based, so the reverse order would make it
 *    useless.
 *  - `prompt_cache_key` is set explicitly and kept stable: it affects
 *    routing of requests to the same cache.
 *  - `max_output_tokens` is shared between reasoning and the response on
 *    reasoning models, hence the headroom: with a tight limit the
 *    response would get cut off mid-JSON, and `incomplete_details.reason`
 *    would be `max_output_tokens`.
 *  - `store: false`: this is batch processing of public data, no reason
 *    to keep it with the provider.
 *  - A refusal arrives NOT as an exception but as a separate response
 *    part of type `refusal`, so it's checked before reading the text.
 */

/**
 * Default flagship model: the same quality tier as the Claude provider,
 * so results are comparable. Cheaper option is `gpt-5-mini` via
 * LLM_MODEL.
 */
const DEFAULT_MODEL = 'gpt-5.2'

export class OpenAIEnricher implements ReasonEnricher {
  readonly name = 'openai'
  readonly model: string
  readonly promptVersion = PROMPT_VERSION

  private readonly client: OpenAI

  constructor(options: { apiKey?: string; model?: string } = {}) {
    // A provider-specific variable: a shared LLM_MODEL would leak into
    // the wrong provider's API on a switch and 404 there.
    this.model = options.model ?? optionalEnv('LLM_MODEL_OPENAI') ?? DEFAULT_MODEL
    // The client retries 429 and 5xx on its own with exponential backoff.
    this.client = new OpenAI({
      apiKey: options.apiKey ?? optionalEnv('OPENAI_API_KEY'),
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

    try {
      const response = await this.client.responses.create({
        model: this.model,
        instructions: buildStablePrefix(input),
        input: `Trecho:\n${remainder}`,
        // The task is a classification task: low effort gives the
        // needed quality noticeably cheaper.
        reasoning: { effort: 'low' },
        text: {
          format: {
            type: 'json_schema',
            name: SCHEMA_NAME,
            schema: buildSchema(categoryCodes, knownSlugs),
            strict: true,
          },
        },
        max_output_tokens: 8000,
        store: false,
        prompt_cache_key: `dou-reasons-${this.promptVersion}`,
      })

      // A refusal is a part of the response, not an exception.
      const refusal = findRefusal(response.output)
      if (refusal !== null) {
        return {
          matchedSlugs: [],
          newReasons: [],
          needsReview: true,
          reviewReason: `model refused the request: ${refusal.slice(0, 160)}`,
          ...base,
        }
      }

      if (response.status !== 'completed') {
        const reason = response.incomplete_details?.reason ?? response.status
        return {
          matchedSlugs: [],
          newReasons: [],
          needsReview: true,
          reviewReason: `response not completed: ${reason}`,
          ...base,
        }
      }

      const usage = {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      }

      const parsed = parseEnrichPayload(response.output_text, categoryCodes, knownSlugs)
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
}

/** Looks for a response part of type `refusal` among the messages. */
function findRefusal(output: OpenAI.Responses.Response['output']): string | null {
  for (const item of output) {
    if (item.type !== 'message') continue
    for (const part of item.content) {
      if (part.type === 'refusal') return part.refusal
    }
  }
  return null
}

function describeError(error: unknown): string {
  if (error instanceof OpenAI.RateLimitError) return 'rate limit exceeded'
  if (error instanceof OpenAI.AuthenticationError) return 'invalid or missing key'
  if (error instanceof OpenAI.PermissionDeniedError) return 'no access to the model'
  if (error instanceof OpenAI.NotFoundError) return 'model not found'
  if (error instanceof OpenAI.BadRequestError) return `request rejected: ${error.message}`
  // APIConnectionError is checked before APIError: it's a subclass of it.
  if (error instanceof OpenAI.APIConnectionError) return 'network unavailable'
  if (error instanceof OpenAI.APIError) return `API error ${error.status ?? '?'}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}
