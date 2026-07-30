/**
 * Сменный провайдер обогащения причин отказа.
 *
 * Провайдер вызывается ТОЛЬКО из воркера и только на остаток, который не
 * покрыли детерминированные правила (по замеру — 6% текстов). Из request
 * path он не вызывается никогда.
 */

export type ReasonCandidate = {
  /** Каноническая формулировка на португальском. */
  textPt: string
  textEn: string
  textRu: string
  /** Код из закрытого списка категорий. */
  categoryCode: string
}

export type EnrichInput = {
  /** Непокрытый остаток текста причины — в исходном виде, с диакритикой. */
  remainder: string
  /** Уже известные атомарные причины: стабильная часть промпта. */
  known: readonly { slug: string; textPt: string; categoryCode: string }[]
  /** Закрытый список категорий. */
  categories: readonly { code: string; nameEn: string }[]
}

export type EnrichResult = {
  /** Slug'и уже существующих причин, которые распознал провайдер. */
  matchedSlugs: string[]
  /** Новые причины, которых в справочнике не было. */
  newReasons: ReasonCandidate[]
  /**
   * true — результата нет: провайдер отказался, вернул мусор или упал.
   * Текст помечается на ручную проверку, а не выбрасывается и не
   * додумывается.
   */
  needsReview: boolean
  /** Почему нужна ручная проверка — попадает в лог и на экран health. */
  reviewReason?: string
  model: string
  promptVersion: string
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
}

export interface ReasonEnricher {
  readonly name: string
  readonly model: string
  readonly promptVersion: string
  enrich(input: EnrichInput): Promise<EnrichResult>
}
