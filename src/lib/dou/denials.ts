import { cleanPersonName, normalizeProcessNumber, stripDiacritics } from '../text'

/**
 * Parsing denial blocks.
 *
 * A block is five consecutive paragraphs:
 *   `Código: 867230`
 *   `Assunto: Indeferimento do pedido`
 *   `Processo: 235881.0744976/2026`
 *   `Interessado: LIBAN ORTEGA GONZALEZ`
 *   long reason text
 *
 * `Código` is the block's best natural key and is used for deduplication.
 */

export type DecisionKind = 'denial' | 'approval' | 'void' | 'archived' | 'other'

export type SubjectKind = 'naturalization' | 'expulsion' | 'nationality_loss' | 'other'

export type ParsedDenial = {
  blockOrdinal: number
  codigo: string | null
  assuntoRaw: string | null
  decisionKind: DecisionKind
  /** `Manutenção de Indeferimento`: an upheld prior decision. */
  isUpheld: boolean
  subjectKind: SubjectKind
  processNumber: string | null
  processNumberNorm: string | null
  fullName: string
  reasonText: string | null
}

export type DenialExtraction = {
  denials: ParsedDenial[]
  unparsed: { text: string; reason: string }[]
}

/**
 * The block label in every spelling observed:
 *   `Interessado:` (262), `Interessada:` (3), `Interessado(a):`
 *   `Processo:` and `Processo nº:` ("nº" sits before the colon)
 * Each uncovered form dropped the whole block, not just corrupted a field.
 */
const LABEL =
  /^(C[oó]digo|Assunto|Processo|Interessad[oa]\(?a?\)?)\s*(?:n[ºo°]\.?)?\s*:\s*(.*)$/i

type Label = 'codigo' | 'assunto' | 'processo' | 'interessado'

function labelOf(raw: string): Label {
  const first = stripDiacritics(raw).toLowerCase()[0]
  if (first === 'c') return 'codigo'
  if (first === 'a') return 'assunto'
  if (first === 'p') return 'processo'
  return 'interessado'
}

/**
 * Classifies the decision by `Assunto`.
 *
 * Normalization is deterministic and covers all 14 observed spellings
 * with one decision tree: strip diacritics, lowercase, trim the trailing
 * period. This matters: `Manutenção de Indeferimento do pedido`,
 * `Manutenção do Indeferimento.`, `MANUTENÇÃO DO INDEFERIMENTO`, and
 * `Manutenção de indeferimento do pedido` all mean the same thing.
 */
export function classifyAssunto(
  assunto: string | null,
  /**
   * The decision text. The type of procedure is often not named in
   * `Assunto`: it just says `Arquivamento do pedido`, and what's actually
   * being terminated is only visible in the body
   * (`processo de Reconhecimento de Igualdade de Direitos`). Without this,
   * unrelated procedures would be counted as naturalization.
   */
  bodyText: string | null = null,
): {
  decisionKind: DecisionKind
  isUpheld: boolean
  subjectKind: SubjectKind
} {
  if (!assunto) return { decisionKind: 'other', isUpheld: false, subjectKind: 'other' }

  const n = stripDiacritics(assunto).toLowerCase().replace(/\.+\s*$/, '').replace(/\s+/g, ' ').trim()
  const body = stripDiacritics(`${assunto} ${bodyText ?? ''}`).toLowerCase()

  const subjectKind: SubjectKind = /expulsao/.test(body)
    ? 'expulsion'
    : /perda da nacionalidade/.test(body)
      ? 'nationality_loss'
      : /igualdade de direitos|reaquisicao de nacionalidade|opcao de nacionalidade/.test(body)
        ? 'other'
        : 'naturalization'

  // "Tornar sem efeito" is checked BEFORE "manutenção": observed
  // `Tornar sem efeito o Recurso de Manutenção de Indeferimento`:
  // that's a reversal of the decision, not an upheld denial, and the
  // reverse check order would have counted it as upheld.
  if (/sem efeito/.test(n)) return { decisionKind: 'void', isUpheld: false, subjectKind }
  // Termination of proceedings is not a denial: the application wasn't ruled on.
  if (/arquivamento|arquivar/.test(n)) {
    return { decisionKind: 'archived', isUpheld: false, subjectKind }
  }
  if (/manuten/.test(n)) return { decisionKind: 'denial', isUpheld: true, subjectKind }
  if (/indeferimento|indefere/.test(n)) {
    return { decisionKind: 'denial', isUpheld: false, subjectKind }
  }
  if (/^deferimento|^defere/.test(n)) {
    return { decisionKind: 'approval', isUpheld: false, subjectKind }
  }

  return { decisionKind: 'other', isUpheld: false, subjectKind }
}

type Draft = {
  codigo: string | null
  assunto: string | null
  processo: string | null
  interessado: string | null
  reasonParts: string[]
}

function emptyDraft(): Draft {
  return { codigo: null, assunto: null, processo: null, interessado: null, reasonParts: [] }
}

function finish(draft: Draft, ordinal: number): ParsedDenial | null {
  if (!draft.interessado) return null

  const reasonText = draft.reasonParts.join(' ').trim()
  const { decisionKind, isUpheld, subjectKind } = classifyAssunto(draft.assunto, reasonText)

  return {
    blockOrdinal: ordinal,
    codigo: draft.codigo,
    assuntoRaw: draft.assunto,
    decisionKind,
    isUpheld,
    subjectKind,
    processNumber: draft.processo,
    processNumberNorm: normalizeProcessNumber(draft.processo),
    fullName: cleanPersonName(draft.interessado),
    reasonText: reasonText.length > 0 ? reasonText : null,
  }
}

/**
 * Paragraphs after `Interessado:` and up to the next `Código:` are the
 * reason text. There can be more than one, so they're concatenated
 * rather than just taking the first.
 */
export function extractDenials(paragraphs: readonly string[]): DenialExtraction {
  const denials: ParsedDenial[] = []
  const unparsed: { text: string; reason: string }[] = []

  let draft: Draft | null = null
  let ordinal = 0

  /** Closes a draft. Doesn't touch the outer variable; the caller does that. */
  const push = (closing: Draft): void => {
    const parsed = finish(closing, ordinal)
    if (parsed) {
      denials.push(parsed)
      ordinal += 1
      return
    }
    unparsed.push({
      text: [closing.codigo, closing.assunto, closing.processo].filter(Boolean).join(' | '),
      reason: 'block without Interessado',
    })
  }

  for (const text of paragraphs) {
    const match = LABEL.exec(text)

    if (match) {
      const label = labelOf(match[1]!)
      const value = match[2]!.trim()

      /*
       * A block boundary is a repeat of an already-filled label, not
       * necessarily `Código`. Field order in the source isn't fixed;
       * measurement found four structures:
       *   codigo,assunto,processo,interessad*  (main, 262 blocks)
       *   assunto,interessad*,processo
       *   processo,assunto,interessad*
       *   processo,assunto
       * Anchoring to `Código` would drop the last three entirely.
       */
      if (draft !== null && draft[label] !== null) {
        push(draft)
        draft = null
      }
      if (draft === null) draft = emptyDraft()

      if (label === 'codigo') draft.codigo = value || null
      else if (label === 'assunto') draft.assunto = value || null
      else if (label === 'processo') draft.processo = value || null
      else draft.interessado = value || null
      continue
    }

    // Reason text follows Interessado; anything before it is the act's preamble.
    if (draft?.interessado) draft.reasonParts.push(text)
  }

  if (draft !== null) push(draft)

  return { denials, unparsed }
}
