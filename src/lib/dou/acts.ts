import { sha256Hex, stripDiacritics } from '../text'
import type { Block } from './page'

/**
 * Splits a page into acts and classifies each one BY CONTENT.
 *
 * Headers can't be trusted: observed forms include `PORTARIA Nº 6.824, DE
 * 28 DE JULHO DE 2026`, `PORTARIA 6.375` without `Nº`, `DESPACHOS`,
 * `Despachos`, `DESPACHO Nº 391/DNN_Naturalizacao_Proc/...`, months in
 * varying case. The index's `artType` field (Portaria/Despacho/Ato) isn't
 * enough either: an approval can show up inside a despacho as
 * `Assunto: Deferimento`.
 */

export type ActKind =
  | 'approval'
  | 'denial_list'
  | 'name_change'
  | 'revocation'
  | 'loss_of_nationality'
  | 'other'

export type NaturalizationType = 'ordinaria' | 'extraordinaria' | 'provisoria' | 'other'

export type ParsedAct = {
  ordinal: number
  identifica: string | null
  kind: ActKind
  naturalizationType: NaturalizationType | null
  /** Legal references as context: 'art.65', 'art.234'. */
  legalBasis: string[]
  paragraphs: string[]
  bodySha256: string
}

/** Approval: the key marker, present in 27 of 27 approval acts. */
const GRANT_PATTERN = /CONCEDER\s+a\s+nacionalidade\s+brasileira/i

/**
 * Structure of a decision block. `Código` or `Assunto` is required.
 * `Processo:` alone isn't enough to tell: work permits are formatted the
 * same way (`Processo: … Requerente: … LTDA Prazo: 2 Anos Imigrante: …`)
 * and would end up in denials as 548 phantom blocks.
 */
const DENIAL_LABEL_PATTERN = /^(?:C[oó]digo|Assunto)\s*:/i

/**
 * Work permit: same department hierarchy, but not naturalization.
 * Filtered out both here and in the relevance filter, regardless of
 * which header it's published under.
 */
const WORK_PERMIT_PATTERN = /\bRequerente\s*:|\bImigrante\s*:|\bPrazo\s*:\s*\d+\s*Ano/i

const LOSS_PATTERN = /perda\s+da\s+nacionalidade/i

/**
 * Name change: `CERTIFICO ainda que, X passou a assinar Y, natural de
 * Portugal, nascida a 30 de julho de 1959, ...`. A trap for a naive
 * parser: the line looks like an approval line.
 */
const NAME_CHANGE_PATTERN = /passou\s+a\s+assinar/i

const REVOCATION_PATTERN = /tornar\s+sem\s+efeito/i

function classify(paragraphs: readonly string[]): ActKind {
  const joined = paragraphs.join('\n')

  // Order matters: unambiguous markers of the act's substance come first.
  if (GRANT_PATTERN.test(joined)) return 'approval'
  if (WORK_PERMIT_PATTERN.test(joined)) return 'other'
  if (paragraphs.some((p) => DENIAL_LABEL_PATTERN.test(p))) return 'denial_list'
  if (LOSS_PATTERN.test(joined)) return 'loss_of_nationality'
  if (NAME_CHANGE_PATTERN.test(joined)) return 'name_change'
  if (REVOCATION_PATTERN.test(joined)) return 'revocation'

  return 'other'
}

/**
 * References to articles of Lei 13.445/2017 and Decreto 9.199/2017.
 * Stored as context, NOT as a reason: `art. 65` appears in 74% of denial
 * texts, and if it were treated as a reason, the chart's largest category
 * would be meaningless. The actual meaning is carried by the inciso
 * number, which is parsed by the reason canonizer.
 */
export function extractLegalBasis(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\bart(?:s?\.|igos?)\s*(\d{1,3})/gi)) {
    found.add(`art.${match[1]}`)
  }
  return [...found].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
}

/**
 * Naturalization type by legal basis. Measured: art.65, 14 acts
 * (ordinary); art.70, 8 (provisional); art.67, 6 (extraordinary).
 */
function naturalizationTypeOf(text: string, legalBasis: readonly string[]): NaturalizationType | null {
  const normalized = stripDiacritics(text).toLowerCase()

  if (/naturalizacao\s+provisoria/.test(normalized)) return 'provisoria'
  if (/naturalizacao\s+extraordinaria/.test(normalized)) return 'extraordinaria'

  if (legalBasis.includes('art.70')) return 'provisoria'
  if (legalBasis.includes('art.67')) return 'extraordinaria'
  if (legalBasis.includes('art.65')) return 'ordinaria'

  return null
}

/**
 * Cuts blocks into acts on `identifica`.
 *
 * Blocks before the first header are the issuing body's letterhead; if
 * there are no headers at all, the whole page counts as one act
 * (observed on pages with a single despacho).
 */
export function splitActs(blocks: readonly Block[]): ParsedAct[] {
  const groups: { identifica: string | null; paragraphs: string[] }[] = []
  let current: { identifica: string | null; paragraphs: string[] } | null = null

  for (const block of blocks) {
    if (block.cls === 'identifica') {
      current = { identifica: block.text, paragraphs: [] }
      groups.push(current)
      continue
    }

    if (block.cls !== 'dou-paragraph') continue

    if (current === null) {
      current = { identifica: null, paragraphs: [] }
      groups.push(current)
    }

    current.paragraphs.push(block.text)
  }

  return groups
    .filter((group) => group.paragraphs.length > 0 || group.identifica !== null)
    .map((group, index) => {
      const joined = [group.identifica ?? '', ...group.paragraphs].join('\n')
      const legalBasis = extractLegalBasis(joined)
      const kind = classify(group.paragraphs)

      return {
        ordinal: index,
        identifica: group.identifica,
        kind,
        naturalizationType: kind === 'approval' ? naturalizationTypeOf(joined, legalBasis) : null,
        legalBasis,
        paragraphs: group.paragraphs,
        bodySha256: sha256Hex(joined),
      }
    })
}
