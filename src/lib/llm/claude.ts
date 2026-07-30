import Anthropic from '@anthropic-ai/sdk'
import type { EnrichInput, EnrichResult, ReasonCandidate, ReasonEnricher } from './types'

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

const PROMPT_VERSION = 'reasons-1'

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

/** Схема ответа: структурированный вывод, а не парсинг прозы. */
function buildSchema(categoryCodes: readonly string[], knownSlugs: readonly string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['matched_slugs', 'new_reasons'],
    properties: {
      matched_slugs: {
        type: 'array',
        items: knownSlugs.length > 0 ? { type: 'string', enum: [...knownSlugs] } : { type: 'string' },
      },
      new_reasons: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text_pt', 'text_en', 'text_ru', 'category_code'],
          properties: {
            text_pt: { type: 'string' },
            text_en: { type: 'string' },
            text_ru: { type: 'string' },
            category_code: { type: 'string', enum: [...categoryCodes] },
          },
        },
      },
    },
  }
}

const INSTRUCTIONS = `Você analisa despachos do Diário Oficial da União do Brasil sobre naturalização.

Recebe o TRECHO de um despacho que ainda não foi classificado por regras determinísticas. A tarefa é decidir quais motivos de indeferimento esse trecho declara.

Regras:
1. Se o trecho corresponde a um motivo da lista de motivos conhecidos, devolva o slug dele em "matched_slugs". Prefira sempre reutilizar um motivo conhecido.
2. Só crie um motivo em "new_reasons" quando nenhum motivo conhecido corresponder. Escreva o texto em português como uma formulação canônica curta e reutilizável — não copie o trecho inteiro, não inclua nomes, números de processo, datas nem citações de artigos de lei.
3. Traduza cada motivo novo para inglês e russo. As traduções devem ser precisas: elas aparecem na interface ao lado do original.
4. "category_code" só pode ser um dos códigos fornecidos.
5. Referências a artigos de lei são CONTEXTO, não motivo. Não crie um motivo cujo texto seja apenas a citação de um artigo.
6. Se o trecho não declara nenhum motivo (é apenas fórmula administrativa), devolva as duas listas vazias.`

export class ClaudeEnricher implements ReasonEnricher {
  readonly name = 'claude'
  readonly model: string
  readonly promptVersion = PROMPT_VERSION

  private readonly client: Anthropic
  /** Выключается, если сервер отверг бета-параметр отката. */
  private serverFallbackEnabled = true

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.model = options.model ?? process.env.LLM_MODEL ?? DEFAULT_MODEL
    // Клиент сам повторяет 429 и 5xx с экспоненциальной задержкой.
    this.client = new Anthropic({
      apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
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
    const stablePrefix = [
      INSTRUCTIONS,
      '',
      'Categorias permitidas:',
      ...input.categories.map((c) => `- ${c.code}: ${c.nameEn}`),
      '',
      'Motivos conhecidos:',
      ...input.known.map((k) => `- ${k.slug} [${k.categoryCode}]: ${k.textPt}`),
    ].join('\n')

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

      const parsed = parseResponse(response.content, categoryCodes, knownSlugs)
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

type ParsedResponse = { matchedSlugs: string[]; newReasons: ReasonCandidate[] }

/**
 * Разбирает ответ. Структурированный вывод гарантирует схему, но
 * значения всё равно перепроверяются: список категорий и slug'ов —
 * закрытый, и лишнее в базу попадать не должно.
 */
function parseResponse(
  content: readonly { type: string; text?: string }[],
  categoryCodes: readonly string[],
  knownSlugs: readonly string[],
): ParsedResponse | null {
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim()

  if (text.length === 0) return null

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }

  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>

  const matchedSlugs = Array.isArray(record.matched_slugs)
    ? record.matched_slugs.filter(
        (slug): slug is string => typeof slug === 'string' && knownSlugs.includes(slug),
      )
    : []

  const newReasons: ReasonCandidate[] = []
  if (Array.isArray(record.new_reasons)) {
    for (const entry of record.new_reasons) {
      if (entry === null || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const textPt = typeof item.text_pt === 'string' ? item.text_pt.trim() : ''
      const categoryCode = typeof item.category_code === 'string' ? item.category_code : ''
      if (textPt.length < 8 || !categoryCodes.includes(categoryCode)) continue

      newReasons.push({
        textPt,
        textEn: typeof item.text_en === 'string' ? item.text_en.trim() : '',
        textRu: typeof item.text_ru === 'string' ? item.text_ru.trim() : '',
        categoryCode,
      })
    }
  }

  return { matchedSlugs: [...new Set(matchedSlugs)], newReasons }
}
