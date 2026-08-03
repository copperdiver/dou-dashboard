/**
 * Legal reference decoder.
 *
 * An article reference is CONTEXT, not a reason: `art. 65` appears in
 * 74% of denial texts, and if it were treated as a reason, the chart's
 * largest category would be meaningless and would drown out the rest.
 *
 * But a reference has a decodable part: the `inciso` number names a
 * specific legal requirement. Some texts don't describe the substance of
 * the denial in words at all: they just cite the article with incisos,
 * and without this decoder they'd go to the LLM unnecessarily.
 *
 * The mappings below are included only where the meaning is confirmed by
 * both the text of the law and the wordings actually observed. Anything
 * uncertain isn't guessed at: it honestly goes to the LLM uncovered.
 */

export type LegalRef = {
  /** `art.65`, `art.234`. */
  article: string
  /** Roman numeral of the inciso as it appears in the text: `II`. */
  inciso: string | null
  /** Slug of the atomic reason, if the inciso is decodable. */
  slug: string | null
  start: number
  end: number
}

/**
 * Lei 13.445/2017, art. 65: requirements for ordinary naturalization.
 * Confirmed by observed texts: `inciso I` appears together with
 * "é menor de idade ... capacidade civil", `inciso III` with
 * "comunicação em português".
 */
const ART_65: Record<string, string> = {
  I: 'minor_capacity',
  II: 'residence_period',
  III: 'portuguese',
  IV: 'criminal_record',
}

/**
 * Decreto 9.199/2017, art. 234: repeats the requirements of art. 65 of
 * the law. Observed `art. 234, incisos II, III e IV` paired with text
 * about proof of address, Portuguese language, and criminal record
 * certificates. Inciso V was observed too, but its meaning isn't
 * confirmed, so it's not mapped.
 */
const ART_234: Record<string, string> = {
  I: 'minor_capacity',
  II: 'residence_period',
  III: 'portuguese',
  IV: 'criminal_record',
}

/**
 * Decreto 9.199/2017, art. 245: the set of documents required for the
 * application. Observed `Art. 245, I do Decreto 9.199/2017` together
 * with "não apresentou o(s) documento(s)", so inciso I is mapped to the
 * generic "missing documents" wording.
 */
const ART_245: Record<string, string> = {
  I: 'docs_generic',
}

const ARTICLE_INCISOS: Record<string, Record<string, string>> = {
  'art.65': ART_65,
  'art.234': ART_234,
  'art.245': ART_245,
}

const ROMAN = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x)$/

/** Parses a list of roman numerals: `ii, iii e iv`. */
function parseIncisos(raw: string): string[] {
  return raw
    .split(/\s*(?:,|\be\b)\s*/)
    .map((part) => part.trim())
    .filter((part) => ROMAN.test(part))
    .map((part) => part.toUpperCase())
}

/*
 * Three orderings, all observed:
 *   art. 65, incisos II, III e IV
 *   incisos II, III e IV do art. 65
 *   Art. 245, I do Decreto
 * Quantifiers are capped and not nested: on a 4000-character paragraph
 * the regex must not fall into catastrophic backtracking, because one
 * Worker handles both parsing and ingestion.
 */
/*
 * A roman numeral as a single character class `[ivx]{1,4}\b`, and NOT an
 * alternation `i{1,3}|iv|v|...`: in the alternation, `i{1,3}` is tried
 * first, and on input `inciso iv` it matches a single `i`, with nothing
 * forcing it to read the number through to the end. That parsed `IV` as
 * `I`, turning "no criminal record certificate" into "minor" in 32% of
 * texts instead of the measured 1%. parseIncisos does the correctness
 * check on the number.
 */
const ROMAN_LIST = String.raw`[ivx]{1,4}\b(?:\s*(?:,|e)\s*[ivx]{1,4}\b)*`

const PATTERNS: readonly { re: RegExp; articleGroup: number; incisoGroup: number }[] = [
  {
    re: new RegExp(String.raw`art\.?\s*(\d{1,3})[^.;]{0,80}?incisos?\s+(${ROMAN_LIST})`, 'g'),
    articleGroup: 1,
    incisoGroup: 2,
  },
  {
    re: new RegExp(String.raw`incisos?\s+(${ROMAN_LIST})[^.;]{0,60}?art\.?\s*(\d{1,3})`, 'g'),
    articleGroup: 2,
    incisoGroup: 1,
  },
  {
    re: new RegExp(String.raw`art\.?\s*(\d{1,3}),\s*(${ROMAN_LIST})\s+d[aeo]\b`, 'g'),
    articleGroup: 1,
    incisoGroup: 2,
  },
]

/** All article mentions, for `reason_texts.legal_refs`. */
const ARTICLE_ONLY = /art(?:s?\.|igos?)\s*(\d{1,3})/g

/**
 * Parses legal references in the NORMALIZED text.
 *
 * Returns both decoded incisos (with a slug) and article mentions
 * without an inciso (slug = null); the latter go into context, not reasons.
 */
export function extractLegalRefs(normalizedText: string): LegalRef[] {
  const refs: LegalRef[] = []
  const seen = new Set<string>()

  for (const { re, articleGroup, incisoGroup } of PATTERNS) {
    re.lastIndex = 0
    for (const match of normalizedText.matchAll(re)) {
      const article = `art.${match[articleGroup]}`
      const table = ARTICLE_INCISOS[article]
      const start = match.index ?? 0
      const end = start + match[0].length

      for (const inciso of parseIncisos(match[incisoGroup] ?? '')) {
        const key = `${article}:${inciso}`
        if (seen.has(key)) continue
        seen.add(key)
        refs.push({ article, inciso, slug: table?.[inciso] ?? null, start, end })
      }
    }
  }

  // Articles without incisos: context only.
  ARTICLE_ONLY.lastIndex = 0
  for (const match of normalizedText.matchAll(ARTICLE_ONLY)) {
    const article = `art.${match[1]}`
    if ([...seen].some((key) => key.startsWith(`${article}:`))) continue
    if (seen.has(article)) continue
    seen.add(article)
    refs.push({
      article,
      inciso: null,
      slug: null,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  }

  return refs.sort((a, b) => a.start - b.start)
}

/** Strings for `reason_texts.legal_refs`: `art.65:III` or `art.221`. */
export function formatLegalRefs(refs: readonly LegalRef[]): string[] {
  return [...new Set(refs.map((r) => (r.inciso ? `${r.article}:${r.inciso}` : r.article)))].sort()
}
