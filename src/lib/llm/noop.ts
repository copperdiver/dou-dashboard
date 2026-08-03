import type { EnrichInput, EnrichResult, ReasonEnricher } from './types'

/**
 * No-op stub that doesn't call an LLM.
 *
 * Used when there's no key or the provider is intentionally disabled.
 * Keeps the Portuguese original and files the reason under "Unclear",
 * NOT making up a translation: a fabricated translation is worse than a
 * missing one, because in the UI it looks just as authoritative as a
 * real one.
 *
 * Flags the result as needsReview so such reasons are visible on the
 * health screen and can be filled in later.
 */
export class NoopEnricher implements ReasonEnricher {
  readonly name = 'noop'
  readonly model = 'none'
  readonly promptVersion = 'noop-1'

  async enrich(input: EnrichInput): Promise<EnrichResult> {
    const textPt = input.remainder.trim().slice(0, 500)

    if (textPt.length === 0) {
      return {
        matchedSlugs: [],
        newReasons: [],
        needsReview: false,
        model: this.model,
        promptVersion: this.promptVersion,
      }
    }

    return {
      matchedSlugs: [],
      newReasons: [
        {
          textPt,
          // No translations: the UI will show the Portuguese original.
          textEn: '',
          textRu: '',
          categoryCode: 'unclear',
        },
      ],
      needsReview: true,
      reviewReason: 'LLM provider disabled: translation and category not filled in',
      model: this.model,
      promptVersion: this.promptVersion,
    }
  }
}
