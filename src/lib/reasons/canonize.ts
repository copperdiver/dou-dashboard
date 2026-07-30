import { sha256Hex } from '../text'
import { extractLegalRefs, formatLegalRefs } from './legal-refs'
import { normalizeWithMap, preambleEnd, segmentClauses, toRawSpan, type Normalized } from './normalize'
import { applyRules, coveredCharRatio, RULES_VERSION } from './rules'

/**
 * Разбор одного текста причины отказа детерминированными средствами.
 *
 * Чистая функция без обращений к БД и сети — так её можно прогонять по
 * фикстурам и видеть последствия правки правил до того, как они попадут
 * в данные.
 *
 * Порядок от дешёвого к дорогому: нормализация → правила по клаузам →
 * декодер правовых ссылок. В LLM уходит только непокрытый остаток,
 * а не весь текст: это и дешевле, и меньше поводов для галлюцинаций.
 */

export type MatchMethod = 'rule' | 'legal_ref'

export type ReasonMatch = {
  slug: string
  method: MatchMethod
  ruleCode: string | null
  /** Координаты в ИСХОДНОМ тексте — под подсветку доказательства. */
  start: number
  end: number
}

export type ReasonAnalysis = {
  /** Нормализованный текст: ключ дедупликации и вход для похожести. */
  normalizedText: string
  normSha256: string
  /** Правовые ссылки как контекст: `art.65:III`, `art.221`. */
  legalRefs: string[]
  matches: ReasonMatch[]
  /** Доля содержательного текста, покрытая спанами. */
  coveredCharRatio: number
  /** Непокрытые клаузы в исходном виде — вход для LLM. Пусто — LLM не нужен. */
  remainder: string
  rulesVersion: number
}

/** Маскирует цифровые серии: 282 текста из 355 отличаются только номерами. */
function maskDigits(value: string): string {
  return value.replace(/\d+/g, '#')
}

function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end
}

export function analyzeReasonText(raw: string): ReasonAnalysis {
  const normalized: Normalized = normalizeWithMap(raw)
  const contentStart = preambleEnd(normalized.text)

  const ruleMatches = applyRules(normalized.text, contentStart)
  const legalRefs = extractLegalRefs(normalized.text)

  const matches: ReasonMatch[] = []
  const seen = new Set<string>()
  const spans: { start: number; end: number }[] = []

  for (const match of ruleMatches) {
    spans.push({ start: match.start, end: match.end })
    // Одна причина на текст, даже если правило сработало несколько раз:
    // связь в denial_reasons имеет ключ (denial_id, reason_id).
    if (seen.has(match.slug)) continue
    seen.add(match.slug)
    const rawSpan = toRawSpan(normalized, match.start, match.end)
    matches.push({ slug: match.slug, method: 'rule', ruleCode: match.ruleCode, ...rawSpan })
  }

  for (const ref of legalRefs) {
    if (ref.slug === null) continue
    spans.push({ start: ref.start, end: ref.end })
    if (seen.has(ref.slug)) continue
    seen.add(ref.slug)
    const rawSpan = toRawSpan(normalized, ref.start, ref.end)
    matches.push({
      slug: ref.slug,
      method: 'legal_ref',
      ruleCode: ref.inciso ? `${ref.article}:${ref.inciso}` : ref.article,
      ...rawSpan,
    })
  }

  // Непокрытый остаток: клаузы, которых не коснулся ни один спан.
  const clauses = segmentClauses(normalized.text, contentStart)
  const uncovered = clauses.filter((clause) => !spans.some((span) => overlaps(span, clause)))

  // Остаток отдаётся LLM в исходном виде, с диакритикой: нормализованный
  // текст читается моделью хуже, а восстановить его она не обязана.
  const remainder = uncovered
    .map((clause) => {
      const rawSpan = toRawSpan(normalized, clause.start, clause.end)
      return raw.slice(rawSpan.start, rawSpan.end).trim()
    })
    .filter((text) => text.length > 12)
    .join('; ')

  const normalizedContent = maskDigits(normalized.text.slice(contentStart)).trim()

  return {
    normalizedText: normalizedContent,
    normSha256: sha256Hex(normalizedContent),
    legalRefs: formatLegalRefs(legalRefs),
    matches,
    coveredCharRatio: Number(
      coveredCharRatio(spans, contentStart, normalized.text.length).toFixed(3),
    ),
    remainder,
    rulesVersion: RULES_VERSION,
  }
}
