import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv } from '../env'
import { buildSchema, buildStablePrefix, parseEnrichPayload, PROMPT_VERSION } from './prompt'
import type { EnrichInput, EnrichResult, ReasonEnricher } from './types'

/**
 * Обогащение причин отказа через Claude.
 *
 * Ключевые особенности модели, учтённые здесь:
 *
 *  - На claude-opus-5 мышление включено ПО УМОЛЧАНИЮ, и `max_tokens`
 *    ограничивает мышление вместе с текстом ответа. Отсюда запас в 8000:
 *    при тесном лимите ответ обрезался бы посреди JSON.
 *  - `temperature`/`top_p`/`top_k` на этой модели возвращают 400 —
 *    их здесь нет и быть не должно.
 *  - Отказ приходит как успешный HTTP 200 со `stop_reason: "refusal"`,
 *    поэтому статус проверяется ДО чтения content: обращение к
 *    content[0] на отказе упало бы.
 *  - Стабильная часть промпта (список известных причин и категорий)
 *    кешируется. Кеш — это префиксное совпадение, поэтому изменчивый
 *    остаток текста идёт в сообщение пользователя, а не в system.
 */

const DEFAULT_MODEL = 'claude-opus-5'

/**
 * То, что мы реально читаем из ответа. Объявлено структурно, потому что
 * бета-эндпоинт и обычный возвращают разные номинальные типы, а поля,
 * которые нужны здесь, у них общие.
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
  /** Выключается, если сервер отверг бета-параметр отката. */
  private serverFallbackEnabled = true

  constructor(options: { apiKey?: string; model?: string } = {}) {
    // Модель задаётся отдельной переменной на провайдера: общий LLM_MODEL
    // при переключении провайдера уехал бы в чужой API и дал бы там 404.
    this.model = options.model ?? optionalEnv('LLM_MODEL_CLAUDE') ?? DEFAULT_MODEL
    // Клиент сам повторяет 429 и 5xx с экспоненциальной задержкой.
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

    // Стабильный префикс: инструкции + справочники. Изменчивый остаток
    // уходит в сообщение пользователя, иначе кеш не переиспользуется.
    const stablePrefix = buildStablePrefix(input)

    try {
      const response = await this.request(stablePrefix, remainder, categoryCodes, knownSlugs)

      // Отказ приходит как успешный ответ — проверяем до чтения content.
      if (response.stop_reason === 'refusal') {
        return {
          matchedSlugs: [],
          newReasons: [],
          needsReview: true,
          reviewReason: `модель отклонила запрос (${response.stop_details?.category ?? 'без категории'})`,
          ...base,
        }
      }

      if (response.stop_reason === 'max_tokens') {
        return {
          matchedSlugs: [],
          newReasons: [],
          needsReview: true,
          reviewReason: 'ответ обрезан по max_tokens',
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

  private async request(
    stablePrefix: string,
    remainder: string,
    categoryCodes: readonly string[],
    knownSlugs: readonly string[],
  ): Promise<MessageLike> {
    const params = {
      model: this.model,
      // Мышление на этой модели включено по умолчанию и делит max_tokens
      // с ответом — запас обязателен.
      max_tokens: 8000,
      output_config: {
        // Задача классификационная: низкое усилие даёт нужное качество
        // заметно дешевле. Мышление при этом НЕ отключаем — на opus-5
        // отключение имеет свои краевые дефекты.
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
      // Классификаторы модели могут отклонить запрос; серверный откат
      // переигрывает его на другой модели в том же вызове.
      const response = await this.client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Parameters<typeof this.client.beta.messages.create>[0])
      return response as MessageLike
    } catch (error) {
      if (error instanceof Anthropic.BadRequestError && /fallback/i.test(error.message)) {
        // Параметр не принят этим аккаунтом или моделью — работаем без него.
        this.serverFallbackEnabled = false
        return (await this.client.messages.create(params)) as MessageLike
      }
      throw error
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return 'лимит запросов исчерпан'
  if (error instanceof Anthropic.AuthenticationError) return 'неверный или отсутствующий ключ'
  if (error instanceof Anthropic.PermissionDeniedError) return 'нет доступа к модели'
  if (error instanceof Anthropic.NotFoundError) return 'модель не найдена'
  // APIConnectionError проверяется раньше APIError: в этом SDK он его подкласс.
  if (error instanceof Anthropic.APIConnectionError) return 'сеть недоступна'
  if (error instanceof Anthropic.APIError) return `ошибка API ${error.status ?? '?'}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}
