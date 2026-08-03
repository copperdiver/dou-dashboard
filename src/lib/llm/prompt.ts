import type { EnrichInput, ReasonCandidate } from './types'

/**
 * Prompt, response schema, and parsing. Shared across all providers.
 *
 * Deliberately factored out here: if each provider had its own wording
 * of the task or its own schema, their results would stop being
 * comparable, and a quality difference would get blamed on the model
 * instead of the prompt.
 *
 * The prompt version is part of the `llm_cache` key: changing it
 * automatically invalidates the old cache.
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
 * Stable part of the prompt: instructions and reference lists.
 *
 * Prompt caching for both providers is a prefix match, so only the
 * unchanging part goes here, and the changing remainder of the text goes
 * into the user part of the request.
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
 * Response schema. Works for both Anthropic (`output_config.format`) and
 * OpenAI (`text.format` with `strict: true`): every object has
 * `additionalProperties: false`, and every property is listed in
 * `required`: without that OpenAI's strict mode rejects the schema.
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
 * Parses the provider's response.
 *
 * Structured output guarantees the shape, but values are still
 * re-validated: the lists of categories and slugs are closed, and
 * nothing extraneous should land in the database. `null` means the
 * response is unusable and the text goes to manual review.
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

  // An array or any other non-object is the wrong response shape. This must
  // be distinguished from a legitimate "no reasons": an empty result
  // marks the text as parsed, while a broken response must go to manual
  // review.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  // Neither expected field present: also the wrong shape.
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
