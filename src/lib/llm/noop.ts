import type { EnrichInput, EnrichResult, ReasonEnricher } from './types'

/**
 * Заглушка без обращения к LLM.
 *
 * Используется, когда ключа нет или провайдер выключен намеренно.
 * Сохраняет португальский оригинал и относит причину к «Неясно», НЕ
 * придумывая переводов: подделанный перевод хуже отсутствующего, потому
 * что в UI он выглядит так же авторитетно, как настоящий.
 *
 * Помечает результат needsReview, чтобы такие причины были видны на
 * экране health и их можно было дозаполнить позже.
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
          // Переводов нет — UI покажет португальский оригинал.
          textEn: '',
          textRu: '',
          categoryCode: 'unclear',
        },
      ],
      needsReview: true,
      reviewReason: 'провайдер LLM выключен: перевод и категория не заполнены',
      model: this.model,
      promptVersion: this.promptVersion,
    }
  }
}
