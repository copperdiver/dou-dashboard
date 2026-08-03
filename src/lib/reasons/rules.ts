/**
 * Deterministic rules for recognizing atomic denial reasons.
 *
 * Rules live in code, not in the DB: they need to be reviewed, tested
 * against fixtures, and revertible. A pattern table in the database
 * sounds flexible, but turns into an unversioned mini-language with no
 * tests. Only the result of applying a rule (`rule_code`, `rules_version`)
 * goes into the DB.
 *
 * Patterns are written WITHOUT diacritics: they're applied to normalized
 * text (see normalize.ts).
 *
 * Measured on 355 texts: the rules below cover 78%, and together with
 * the legal reference decoder, 82%. The remainder goes to the LLM.
 */

/** Bump on any rule change: texts will be reparsed. */
export const RULES_VERSION = 1

type Rule = {
  code: string
  /** Matches the slug of the atomic reason in the reference table. */
  slug: string
  pattern: RegExp
  /** Frequency from measurement, for readability of the ordering. */
  note?: string
}

/*
 * Order in the array doesn't matter: all rules are applied. Quantifiers
 * aren't nested: one Worker handles both parsing and ingestion, so
 * catastrophic backtracking would freeze the pipeline.
 */
const RULES: readonly Rule[] = [
  {
    code: 'R01',
    slug: 'criminal_record',
    pattern: /antecedentes criminais|certid\w{0,4} de antecedentes/g,
    note: '41%',
  },
  {
    code: 'R02',
    slug: 'portuguese',
    // `comunicacao em portugues` wasn't caught by the first version of
    // the rule: 15 texts went to the LLM unnecessarily.
    pattern: /lingua portuguesa|comunica\w{0,4} em portugu\w{0,3}/g,
    note: '31%',
  },
  {
    code: 'R03',
    slug: 'deadline_no_reply',
    pattern: /nao respondeu|dentro do prazo|prazo previsto|nao se manifestou/g,
    note: '23%',
  },
  {
    code: 'R04',
    slug: 'residence_proof',
    // Both `comprovante` and `comprovacao`: the second form was being missed.
    pattern: /comprova\w{0,4} de resid\w{0,5}|comprovante de endere\w{0,2}/g,
    note: '20%',
  },
  {
    code: 'R05',
    slug: 'residence_period',
    pattern: /prazo minimo exig\w{0,4}|prazo de resid\w{0,5}|residencia por prazo/g,
    note: '15%',
  },
  {
    code: 'R06',
    slug: 'travel_doc',
    pattern: /documento de viagem|passaporte/g,
    note: '15%',
  },
  {
    code: 'R07',
    slug: 'no_show',
    pattern: /nao compareceu/g,
    note: '9%',
  },
  {
    code: 'R08',
    slug: 'wrong_track',
    pattern: /nao se enquadra ness[ea] modelo/g,
    note: '9%',
  },
  {
    code: 'R09',
    slug: 'cpf',
    pattern: /\bcpf\b/g,
    note: '6%',
  },
  {
    code: 'R10',
    slug: 'minor_capacity',
    pattern: /menor de idade|capacidade civil/g,
    note: '1%',
  },
  {
    code: 'R11',
    slug: 'docs_generic',
    pattern: /nao apresentou os documentos/g,
    note: '23%, vague → "Unclear" category',
  },
  {
    code: 'R12',
    slug: 'requirements_generic',
    pattern: /nao cumprimento das exigencias/g,
    note: '37%, vague → "Unclear" category',
  },
]

export type RuleMatch = {
  slug: string
  ruleCode: string
  /** Coordinates in the normalized text. */
  start: number
  end: number
}

/** Applies all rules to the normalized text starting at `from`. */
export function applyRules(normalizedText: string, from = 0): RuleMatch[] {
  const matches: RuleMatch[] = []
  const haystack = normalizedText.slice(from)

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    for (const match of haystack.matchAll(rule.pattern)) {
      const start = from + (match.index ?? 0)
      matches.push({
        slug: rule.slug,
        ruleCode: rule.code,
        start,
        end: start + match[0].length,
      })
    }
  }

  return matches.sort((a, b) => a.start - b.start)
}

/** Merges overlapping spans. */
export function mergeSpans(
  spans: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
  if (spans.length === 0) return []

  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = [{ ...sorted[0]! }]

  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1]!
    if (span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }

  return merged
}

/**
 * Share of the substantive text covered by spans. A quality metric: a
 * drop on new data means the source changed its wording and the rules
 * silently stopped matching.
 */
export function coveredCharRatio(
  spans: readonly { start: number; end: number }[],
  from: number,
  total: number,
): number {
  const length = total - from
  if (length <= 0) return 0
  const covered = mergeSpans(spans).reduce(
    (sum, span) => sum + (Math.min(span.end, total) - Math.max(span.start, from)),
    0,
  )
  return Math.min(1, Math.max(0, covered / length))
}

export const RULE_CODES = RULES.map((r) => ({ code: r.code, slug: r.slug, note: r.note }))
