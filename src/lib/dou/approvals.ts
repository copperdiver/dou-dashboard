import { cleanPersonName, normalizeProcessNumber, sha256Hex, stripDiacritics } from '../text'

/**
 * Parsing person-lines in citizenship grant acts.
 *
 * Format measured across 515 lines:
 *   `NAME - F009513-S, natural da Colômbia, nascido(a) em 7 de outubro de
 *    1979, filho(a) de X e de Y, residente no Estado do Paraná
 *    (Processo nº 235881.0423562/2023);`
 *
 * Fields are extracted independently rather than with one monolithic
 * regex: the source allows gaps (3 lines with no birth date, 2 with no
 * state, 1 with no process number), and a monolith would drop such lines
 * entirely instead of parsing them partially.
 */

export type ParsedApproval = {
  fullName: string
  documentId: string | null
  countryRaw: string | null
  birthDate: string | null
  birthDateRaw: string | null
  parentsRaw: string | null
  stateRaw: string | null
  processNumber: string | null
  processNumberNorm: string | null
  paragraphText: string
  paragraphSha256: string
  /** Share of fields found: below 1 means some data is missing in the source. */
  confidence: number
}

export type ApprovalExtraction = {
  people: ParsedApproval[]
  /** Paragraphs that look like a person-line but weren't parsed. Not discarded. */
  unparsed: { text: string; reason: string }[]
}

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
}

/** A paragraph that looks like a person-line. */
const CANDIDATE = /natural\s+d/i

/**
 * Boilerplate paragraphs of the act that also contain `natural d` or
 * otherwise masquerade as a person-line.
 */
const SKIP_PATTERNS: readonly RegExp[] = [
  /^CERTIFICO\b/i,
  /passou\s+a\s+assinar/i,
  /^CONCEDER\b/i,
  /^A[s]?\s+pessoas?\s+referidas?\s+nesta/i,
  /dever[ãa]o?\s+comparecer\s+perante\s+a\s+Justi[çc]a\s+Eleitoral/i,
]

/** `7 de outubro de 1979` → `1979-10-07`. */
function parseBirthDate(text: string): { iso: string | null; raw: string | null } {
  const flat = stripDiacritics(text).toLowerCase()
  // Observed `nascido em`, `nascida em`, `nascido(a) em`, and `nascida a`.
  const match = /nascid[oa](?:\(a\))?\s+(?:em|a)\s+(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/.exec(flat)
  if (!match) return { iso: null, raw: null }

  const day = Number.parseInt(match[1]!, 10)
  const month = MONTHS[match[2]!]
  const year = Number.parseInt(match[3]!, 10)

  const raw = `${match[1]} de ${match[2]} de ${match[3]}`
  if (!month || day < 1 || day > 31 || year < 1900 || year > 2100) return { iso: null, raw }

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  // Catches February 31 and similar.
  const check = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== day) return { iso: null, raw }

  return { iso, raw }
}

function extractName(text: string): { name: string; documentId: string | null } | null {
  // Name is separated from the document via ` - ` in 499 of 515 lines.
  // A comma after the document number is optional: observed
  // `GIANCARLO ENRIQUE MORA FLORES - V320840-8 natural do Equador`.
  // `RNM` written out as a word before the number appears in only 1 of
  // 515 lines, but without this alternative the number bled into the name.
  const dashed =
    /^\s*([^,]{2,120}?)\s+-\s+(?:RNM\s+)?([A-Za-z]?-?\d[\w.\-/]*)\s*(?:,|\s+natural\s)/i.exec(text)
  if (dashed) return { name: dashed[1]!.trim(), documentId: dashed[2]!.trim() }

  // No document: name up to `, natural`.
  const plain = /^\s*(.{2,120}?)\s*,\s*natural\s+d/i.exec(text)
  if (plain) return { name: plain[1]!.trim(), documentId: null }

  return null
}

function extractCountry(text: string): string | null {
  // Preposition: da(234) / do(219) / de(58) / dos(4). The `d[aeo]{1,2}s?`
  // pattern also covers the source typo `natural doa Estados Unidos`;
  // without it, that person would be lost entirely.
  const withBirth = /natural\s+d[aeo]{1,2}s?\s+([^,]{2,60}?)\s*,\s*nascid/i.exec(text)
  if (withBirth) return withBirth[1]!.trim()

  // No comma before `nascid…`: observed `natural de Cuba nascida em
  // agosto de 1977`; without this boundary, half the line ended up in
  // the country field.
  const bare = /natural\s+d[aeo]{1,2}s?\s+([^,]{2,60}?)\s*(?:,|\.|;|\s+nascid|$)/i.exec(text)
  return bare ? bare[1]!.trim() : null
}

function extractState(text: string): string | null {
  // `residente no estado de São Paulo`(455) / `no Estado do Paraná`(53) /
  // `no Distrito Federal`(5); case doesn't matter.
  const match =
    /residente\s+n[oa]s?\s+(?:estado\s+d[aeo]s?\s+)?([^,()]{2,60}?)\s*(?:\(|,|;|\.|$)/i.exec(text)
  return match ? match[1]!.trim() : null
}

function extractParents(text: string): string | null {
  const match = /filh[oa](?:\(a\))?\s+de\s+(.{2,200}?)\s*,\s*residente/i.exec(text)
  return match ? match[1]!.trim() : null
}

function extractProcess(text: string): { raw: string | null; norm: string | null } {
  const match = /\(\s*Processo[^)]*\)/i.exec(text)
  const raw = match ? match[0].replace(/^\(\s*|\s*\)$/g, '').trim() : null
  return { raw, norm: normalizeProcessNumber(raw ?? text) }
}

/**
 * Parses the paragraphs of an approval act.
 *
 * A paragraph that looks like a person-line but couldn't be parsed goes
 * into `unparsed` instead of being discarded: silently losing people is
 * the worst possible failure mode for this parser.
 */
export function extractApprovals(paragraphs: readonly string[]): ApprovalExtraction {
  const people: ParsedApproval[] = []
  const unparsed: { text: string; reason: string }[] = []

  for (const text of paragraphs) {
    if (!CANDIDATE.test(text)) continue
    if (SKIP_PATTERNS.some((pattern) => pattern.test(text))) continue

    const named = extractName(text)
    if (!named) {
      unparsed.push({ text, reason: 'name not extracted' })
      continue
    }

    const countryRaw = extractCountry(text)
    if (!countryRaw) {
      unparsed.push({ text, reason: 'country of birth not extracted' })
      continue
    }

    const birth = parseBirthDate(text)
    const stateRaw = extractState(text)
    const process = extractProcess(text)

    const present = [birth.iso, stateRaw, process.norm, named.documentId].filter(
      (v) => v !== null,
    ).length

    people.push({
      fullName: cleanPersonName(named.name),
      documentId: named.documentId,
      countryRaw,
      birthDate: birth.iso,
      birthDateRaw: birth.raw,
      parentsRaw: extractParents(text),
      stateRaw,
      processNumber: process.raw,
      processNumberNorm: process.norm,
      paragraphText: text,
      paragraphSha256: sha256Hex(text),
      // Name and country are already present; the other four fields are optional.
      confidence: Number(((2 + present) / 6).toFixed(2)),
    })
  }

  return { people, unparsed }
}
