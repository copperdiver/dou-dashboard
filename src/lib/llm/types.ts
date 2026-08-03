/**
 * Swappable denial reason enrichment provider.
 *
 * The provider is called ONLY from the worker, and only for the
 * remainder not covered by deterministic rules (measured at 6% of
 * texts). It's never called from the request path.
 */

export type ReasonCandidate = {
  /** Canonical wording in Portuguese. */
  textPt: string
  textEn: string
  textRu: string
  /** Code from the closed list of categories. */
  categoryCode: string
}

export type EnrichInput = {
  /** Uncovered remainder of the reason text, as-is, with diacritics. */
  remainder: string
  /** Already known atomic reasons: the stable part of the prompt. */
  known: readonly { slug: string; textPt: string; categoryCode: string }[]
  /** Closed list of categories. */
  categories: readonly { code: string; nameEn: string }[]
}

export type EnrichResult = {
  /** Slugs of already-existing reasons that the provider recognized. */
  matchedSlugs: string[]
  /** New reasons that weren't in the reference list. */
  newReasons: ReasonCandidate[]
  /**
   * true means there's no result: the provider refused, returned
   * garbage, or failed. The text is flagged for manual review rather
   * than discarded or guessed at.
   */
  needsReview: boolean
  /** Why manual review is needed. Goes into the log and the health screen. */
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
