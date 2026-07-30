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
 * Обогащение причин отказа через OpenAI (Responses API).
 *
 * Учтённые особенности:
 *
 *  - `instructions` рендерится перед `input`, поэтому стабильная часть
 *    промпта идёт туда, а меняющийся остаток — в `input`. Кеширование
 *    промпта префиксное, обратный порядок сделал бы его бесполезным.
 *  - `prompt_cache_key` задаётся явно и стабильно: он влияет на
 *    маршрутизацию запросов к одному и тому же кешу.
 *  - `max_output_tokens` делится между рассуждением и ответом на
 *    reasoning-моделях, отсюда запас: при тесном лимите ответ обрывался
 *    бы посреди JSON, а `incomplete_details.reason` был бы
 *    `max_output_tokens`.
 *  - `store: false` — это пакетная обработка публичных данных, хранить
 *    её у провайдера незачем.
 *  - Отказ приходит НЕ исключением, а отдельной частью ответа типа
 *    `refusal`, поэтому она проверяется до чтения текста.
 */

/**
 * Флагманская модель по умолчанию — тот же уровень качества, что у
 * Claude-провайдера, чтобы результаты были сравнимы. Дешевле — `gpt-5-mini`
 * через LLM_MODEL.
 */
const DEFAULT_MODEL = 'gpt-5.2'

export class OpenAIEnricher implements ReasonEnricher {
  readonly name = 'openai'
  readonly model: string
  readonly promptVersion = PROMPT_VERSION

  private readonly client: OpenAI

  constructor(options: { apiKey?: string; model?: string } = {}) {
    // Своя переменная на провайдера: общий LLM_MODEL при переключении
    // провайдера уехал бы в чужой API и дал бы там 404.
    this.model = options.model ?? optionalEnv('LLM_MODEL_OPENAI') ?? DEFAULT_MODEL
    // Клиент сам повторяет 429 и 5xx с экспоненциальной задержкой.
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
        // Задача классификационная: низкое усилие даёт нужное качество
        // заметно дешевле.
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

      // Отказ — это часть ответа, а не исключение.
      const refusal = findRefusal(response.output)
      if (refusal !== null) {
        return {
          matchedSlugs: [],
          newReasons: [],
          needsReview: true,
          reviewReason: `модель отклонила запрос: ${refusal.slice(0, 160)}`,
          ...base,
        }
      }

      if (response.status !== 'completed') {
        const reason = response.incomplete_details?.reason ?? response.status
        return {
          matchedSlugs: [],
          newReasons: [],
          needsReview: true,
          reviewReason: `ответ не завершён: ${reason}`,
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
          reviewReason: 'ответ не соответствует схеме',
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

/** Ищет часть ответа типа `refusal` среди сообщений. */
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
  if (error instanceof OpenAI.RateLimitError) return 'лимит запросов исчерпан'
  if (error instanceof OpenAI.AuthenticationError) return 'неверный или отсутствующий ключ'
  if (error instanceof OpenAI.PermissionDeniedError) return 'нет доступа к модели'
  if (error instanceof OpenAI.NotFoundError) return 'модель не найдена'
  if (error instanceof OpenAI.BadRequestError) return `запрос отвергнут: ${error.message}`
  // APIConnectionError проверяется раньше APIError: он его подкласс.
  if (error instanceof OpenAI.APIConnectionError) return 'сеть недоступна'
  if (error instanceof OpenAI.APIError) return `ошибка API ${error.status ?? '?'}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}
