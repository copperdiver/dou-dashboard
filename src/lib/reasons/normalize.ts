/**
 * Normalizing denial reason text while preserving offsets, and splitting
 * it into clauses.
 *
 * The offsets aren't cosmetic: rules return evidence spans, the covered
 * text ratio is computed from them, and (most importantly) only the
 * uncovered remainder goes to the LLM, not the whole text. Without
 * mapping back to the original coordinates there'd be nothing to
 * highlight as evidence.
 */

export type Normalized = {
  /** No diacritics, lowercase, single spaces. */
  text: string
  /** map[i]: index of the source-string character that produced text[i]. */
  map: number[]
}

/**
 * Builds the normalized string along with a mapping back to source indices.
 *
 * Diacritics are stripped via NFD: `ã` → `a` + combining tilde, and the
 * second part is discarded. This changes the string length, so a naive
 * `indexOf` on the normalized text wouldn't give the position in the
 * original.
 */
export function normalizeWithMap(raw: string): Normalized {
  const chars: string[] = []
  const map: number[] = []
  let pendingSpace = false

  for (let i = 0; i < raw.length; i += 1) {
    const source = raw[i]!

    if (/\s/.test(source)) {
      // A run of whitespace collapses into one space; leading whitespace is dropped.
      if (chars.length > 0) pendingSpace = true
      continue
    }

    if (pendingSpace) {
      chars.push(' ')
      map.push(i)
      pendingSpace = false
    }

    for (const part of source.normalize('NFD')) {
      // Discard combining marks (U+0300..U+036F and others).
      if (/\p{Mn}/u.test(part)) continue
      chars.push(part.toLowerCase())
      map.push(i)
    }
  }

  return { text: chars.join(''), map }
}

/** Converts a span in normalized coordinates back to source coordinates. */
export function toRawSpan(
  normalized: Normalized,
  start: number,
  end: number,
): { start: number; end: number } {
  const rawStart = normalized.map[start] ?? 0
  // end points past the last character, so take the mapping of the last
  // included character and add one.
  const lastIndex = Math.max(start, end - 1)
  const rawEnd = (normalized.map[lastIndex] ?? rawStart) + 1
  return { start: rawStart, end: rawEnd }
}

/**
 * The preamble present in almost every reason text. Carries no meaning,
 * but pollutes both similarity comparison and the LLM prompt.
 *
 * Returns the position in the NORMALIZED text where the substantive part begins.
 */
/*
 * Head of the preamble: job title plus the authority formula. Observed
 * `A COORDENADORA DE PROCESSOS MIGRATÓRIOS, no uso da competência
 * delegada pela Portaria nº 623...` and `O CHEFE DA DIVISÃO ..., no uso
 * de suas atribuições legais`.
 */
const PREAMBLE_HEAD =
  /^[ao]\s+(?:coordenador[ae]?|chefe|dirigente)\b[\s\S]{0,300}?(?:competencia\s+delegada|atribui\w+\s+lega\w+)/

/**
 * The start of the substantive part: a decision verb or a phrase
 * introducing the grounds. Anchored to these rather than counting
 * commas: the preamble has several commas (portaria number, date,
 * publication date), and a pattern like `[^,]*,` would stop at the
 * first one, leaving half the preamble inside the reason text.
 */
const SUBSTANCE =
  /\b(?:indefere|indeferir|indeferido|defere|deferir|considerando|resolve|declara|declarar|arquivar|arquivamento|tendo em vista|em razao|por descumprimento|nos termos)\b/

export function preambleEnd(normalizedText: string): number {
  const head = PREAMBLE_HEAD.exec(normalizedText)
  if (!head) return 0

  const rest = normalizedText.slice(head[0].length)
  const substance = SUBSTANCE.exec(rest)
  // Head is present but there's no substance marker, so cut only the head:
  // don't discard the whole text.
  return substance ? head[0].length + substance.index : head[0].length
}

/** Masks digit sequences: law, article, and date numbers carry no meaning. */
export function maskDigits(value: string): string {
  return value.replace(/\d+/g, '#')
}

/**
 * Deduplication key for a reason text.
 *
 * Cheap and NOT dependent on the rules version: the parser computes it
 * when creating `reason_texts`, so identical texts aren't inserted twice.
 * Measured: 267 texts collapse into 203 unique ones, and rules and the
 * LLM operate on the unique set, not on every denial.
 *
 * The only normalization implementation in the project: anyone who
 * needs this key calls it rather than duplicating the logic.
 */
export function reasonDedupKey(raw: string): { textNorm: string; normSha256Input: string } {
  const normalized = normalizeWithMap(raw)
  const textNorm = maskDigits(normalized.text.slice(preambleEnd(normalized.text))).trim()
  return { textNorm, normSha256Input: textNorm }
}

export type Clause = {
  text: string
  /** Coordinates in the normalized text. */
  start: number
  end: number
}

/**
 * Abbreviations after whose period a sentence does NOT end. Without this
 * guard, `art. 65` would be split into two clauses, and a rule relying
 * on the article number together with the inciso would stop matching.
 */
const ABBREVIATIONS = new Set([
  'art',
  'arts',
  'inc',
  'incs',
  'incisos',
  'inciso',
  'no',
  'n',
  'nº',
  'lei',
  'dec',
  'decreto',
  'port',
  'portaria',
  'item',
  'itens',
  'al',
  'par',
  'paragrafo',
  'mm',
  'sr',
  'sra',
  'dr',
  'dra',
  'cf',
  'p',
  'pag',
])

function isAbbreviationBefore(text: string, dotIndex: number): boolean {
  let start = dotIndex - 1
  while (start >= 0 && /[\p{L}\p{N}º°]/u.test(text[start]!)) start -= 1
  const token = text.slice(start + 1, dotIndex)
  if (token.length === 0) return false
  // A single letter or digit is almost always an initial or a number.
  if (token.length === 1) return true
  if (/^\d+$/.test(token)) return true
  return ABBREVIATIONS.has(token)
}

/**
 * Splits the normalized text into clauses.
 *
 * Boundaries: `;`, the enumerative ` e `, and `. ` with abbreviation
 * protection. Clauses exist so that rules and similarity comparison work
 * on meaningful fragments: similarity over the full text makes all texts
 * look alike because of shared legal boilerplate.
 */
export function segmentClauses(normalizedText: string, from = 0): Clause[] {
  const clauses: Clause[] = []
  let start = from

  const push = (end: number) => {
    const text = normalizedText.slice(start, end).trim()
    if (text.length >= 3) {
      // Recompute boundaries after trim, so spans don't include whitespace.
      const leading = normalizedText.slice(start, end).indexOf(text[0]!)
      const realStart = start + Math.max(0, leading)
      clauses.push({ text, start: realStart, end: realStart + text.length })
    }
  }

  for (let i = from; i < normalizedText.length; i += 1) {
    const ch = normalizedText[i]!

    if (ch === ';') {
      push(i)
      start = i + 1
      continue
    }

    if (ch === '.' && (i + 1 >= normalizedText.length || normalizedText[i + 1] === ' ')) {
      if (isAbbreviationBefore(normalizedText, i)) continue
      push(i)
      start = i + 1
      continue
    }

    // The enumerative ` e ` is a boundary only if there's enough text on
    // both sides, otherwise names like `X e Y` get split.
    if (
      ch === ' ' &&
      normalizedText.slice(i, i + 3) === ' e ' &&
      i - start > 30 &&
      normalizedText.length - i > 30
    ) {
      push(i)
      start = i + 3
      i += 2
    }
  }

  push(normalizedText.length)

  return clauses
}
