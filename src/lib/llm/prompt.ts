import type { EnrichInput, ReasonCandidate } from './types'

/**
 * Промпт, схема ответа и разбор — общие для всех провайдеров.
 *
 * Вынесено сюда сознательно: если у каждого провайдера будет своя
 * формулировка задачи или своя схема, их результаты перестанут быть
 * сравнимыми, а различие в качестве спишется на модель вместо промпта.
 *
 * Версия промпта участвует в ключе `llm_cache`: её изменение
 * автоматически обесценивает старый кеш.
 */
export const PROMPT_VERSION = 'reasons-1'

export const INSTRUCTIONS = `Você analisa despachos do Diário Oficial da União do Brasil sobre naturalização.

Recebe o TRECHO de um despacho que ainda não foi classificado por regras determinísticas. A tarefa é decidir quais motivos de indeferimento esse trecho declara.

Regras:
1. Se o trecho corresponde a um motivo da lista de motivos conhecidos, devolva o slug dele em "matched_slugs". Prefira sempre reutilizar um motivo conhecido.
2. Só crie um motivo em "new_reasons" quando nenhum motivo conhecido corresponder. Escreva o texto em português como uma formulação canônica curta e reutilizável — não copie o trecho inteiro, não inclua nomes, números de processo, datas nem citações de artigos de lei.
3. Traduza cada motivo novo para inglês e russo. As traduções devem ser precisas: elas aparecem na interface ao lado do original.
4. "category_code" só pode ser um dos códigos fornecidos.
5. Referências a artigos de lei são CONTEXTO, não motivo. Não crie um motivo cujo texto seja apenas a citação de um artigo.
6. Se o trecho não declara nenhum motivo (é apenas fórmula administrativa), devolva as duas listas vazias.`

/**
 * Стабильная часть промпта: инструкции и справочники.
 *
 * Кеширование промпта у обоих провайдеров — префиксное совпадение,
 * поэтому здесь только неизменное, а меняющийся остаток текста уходит
 * в пользовательскую часть запроса.
 */
export function buildStablePrefix(input: EnrichInput): string {
  return [
    INSTRUCTIONS,
    '',
    'Categorias permitidas:',
    ...input.categories.map((c) => `- ${c.code}: ${c.nameEn}`),
    '',
    'Motivos conhecidos:',
    ...input.known.map((k) => `- ${k.slug} [${k.categoryCode}]: ${k.textPt}`),
  ].join('\n')
}

/**
 * Схема ответа. Годится и для Anthropic (`output_config.format`), и для
 * OpenAI (`text.format` со `strict: true`): у всех объектов
 * `additionalProperties: false`, и все свойства перечислены в `required` —
 * без этого строгий режим OpenAI схему отвергает.
 */
export function buildSchema(
  categoryCodes: readonly string[],
  knownSlugs: readonly string[],
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['matched_slugs', 'new_reasons'],
    properties: {
      matched_slugs: {
        type: 'array',
        items:
          knownSlugs.length > 0 ? { type: 'string', enum: [...knownSlugs] } : { type: 'string' },
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

export const SCHEMA_NAME = 'denial_reasons'

export type EnrichPayload = { matchedSlugs: string[]; newReasons: ReasonCandidate[] }

/**
 * Разбирает ответ провайдера.
 *
 * Структурированный вывод гарантирует форму, но значения всё равно
 * перепроверяются: списки категорий и slug'ов закрытые, и лишнее в базу
 * попадать не должно. `null` — ответ непригоден, текст уходит на ручную
 * проверку.
 */
export function parseEnrichPayload(
  text: string,
  categoryCodes: readonly string[],
  knownSlugs: readonly string[],
): EnrichPayload | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null

  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return null
  }

  // Массив и любой другой не-объект — ответ не той формы. Отличать это
  // от законного «мотивов нет» обязательно: пустой результат помечает
  // текст разобранным, а сломанный ответ должен уйти на ручную проверку.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  // Ни одного ожидаемого поля — тоже не та форма.
  if (!Array.isArray(record.matched_slugs) && !Array.isArray(record.new_reasons)) return null

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
