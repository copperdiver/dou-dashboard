import { sha256Hex } from '../text'
import { extractLegalRefs, formatLegalRefs } from './legal-refs'
import { normalizeWithMap, preambleEnd, segmentClauses, toRawSpan, type Normalized } from './normalize'
import { applyRules, coveredCharRatio, RULES_VERSION } from './rules'

/**
 * Parsing a single denial reason text with deterministic means.
 *
 * A pure function with no DB or network calls, so it can be run against
 * fixtures to see the effect of a rule change before it hits real data.
 *
 * Order goes from cheap to expensive: normalization → clause-level rules
 * → legal reference decoder. Only the uncovered remainder goes to the
 * LLM, not the whole text: cheaper, and fewer chances to hallucinate.
 */

export type MatchMethod = 'rule' | 'legal_ref'

export type ReasonMatch = {
  slug: string
  method: MatchMethod
  ruleCode: string | null
  /** Coordinates in the ORIGINAL text, for highlighting the evidence. */
  start: number
  end: number
}

export type ReasonAnalysis = {
  /** Normalized text: dedup key and input for similarity. */
  normalizedText: string
  normSha256: string
  /** Legal references as context: `art.65:III`, `art.221`. */
  legalRefs: string[]
  matches: ReasonMatch[]
  /** Share of the substantive text covered by spans. */
  coveredCharRatio: number
  /** Uncovered clauses verbatim, input for the LLM. Empty means the LLM isn't needed. */
  remainder: string
  rulesVersion: number
}

/** Masks digit sequences: 282 of 355 texts differ only by numbers. */
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
    // One reason per text even if the rule matched multiple times: the
    // link in denial_reasons is keyed on (denial_id, reason_id).
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

  // Uncovered remainder: clauses that no span touched.
  const clauses = segmentClauses(normalized.text, contentStart)
  const uncovered = clauses.filter((clause) => !spans.some((span) => overlaps(span, clause)))

  // The remainder is handed to the LLM verbatim, with diacritics: the
  // normalized text is harder for the model to read, and it isn't
  // obligated to reconstruct it.
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
