import { cleanPersonName, normalizeProcessNumber, stripDiacritics } from '../text'

/**
 * Разбор блоков отказа.
 *
 * Блок — пять абзацев подряд:
 *   `Código: 867230`
 *   `Assunto: Indeferimento do pedido`
 *   `Processo: 235881.0744976/2026`
 *   `Interessado: LIBAN ORTEGA GONZALEZ`
 *   длинный текст причины
 *
 * `Código` — лучший естественный ключ блока и используется для
 * дедупликации.
 */

export type DecisionKind = 'denial' | 'approval' | 'void' | 'archived' | 'other'

export type SubjectKind = 'naturalization' | 'expulsion' | 'nationality_loss' | 'other'

export type ParsedDenial = {
  blockOrdinal: number
  codigo: string | null
  assuntoRaw: string | null
  decisionKind: DecisionKind
  /** `Manutenção de Indeferimento` — подтверждение прежнего решения. */
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
 * Метка блока во всех наблюдавшихся написаниях:
 *   `Interessado:` (262), `Interessada:` (3), `Interessado(a):`
 *   `Processo:` и `Processo nº:` — «nº» стоит перед двоеточием
 * Каждая непокрытая форма теряла блок целиком, а не портила поле.
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
 * Классификация решения по `Assunto`.
 *
 * Нормализация детерминированная и покрывает все 14 наблюдённых написаний
 * одним деревом: снятие диакритики, нижний регистр, срез точки. Это важно —
 * `Manutenção de Indeferimento do pedido`, `Manutenção do Indeferimento.`,
 * `MANUTENÇÃO DO INDEFERIMENTO` и `Manutenção de indeferimento do pedido`
 * означают одно и то же.
 */
export function classifyAssunto(
  assunto: string | null,
  /**
   * Текст решения. Вид процедуры в `Assunto` часто не назван: там стоит
   * просто `Arquivamento do pedido`, а что именно прекращено — видно
   * только в теле (`processo de Reconhecimento de Igualdade de Direitos`).
   * Без этого чужие процедуры считались бы натурализацией.
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

  // «Tornar sem efeito» проверяется ПЕРЕД «manutenção»: наблюдалось
  // `Tornar sem efeito o Recurso de Manutenção de Indeferimento` —
  // это отмена решения, а не подтверждение отказа, и обратный порядок
  // проверок засчитал бы его подтверждением.
  if (/sem efeito/.test(n)) return { decisionKind: 'void', isUpheld: false, subjectKind }
  // Прекращение производства — не отказ: заявление не рассмотрено по существу.
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
 * Абзацы после `Interessado:` и до следующего `Código:` — текст причины.
 * Их может быть больше одного, поэтому они склеиваются, а не берётся
 * только первый.
 */
export function extractDenials(paragraphs: readonly string[]): DenialExtraction {
  const denials: ParsedDenial[] = []
  const unparsed: { text: string; reason: string }[] = []

  let draft: Draft | null = null
  let ordinal = 0

  /** Закрывает черновик. Внешнюю переменную не трогает — это делает вызов. */
  const push = (closing: Draft): void => {
    const parsed = finish(closing, ordinal)
    if (parsed) {
      denials.push(parsed)
      ordinal += 1
      return
    }
    unparsed.push({
      text: [closing.codigo, closing.assunto, closing.processo].filter(Boolean).join(' | '),
      reason: 'блок без Interessado',
    })
  }

  for (const text of paragraphs) {
    const match = LABEL.exec(text)

    if (match) {
      const label = labelOf(match[1]!)
      const value = match[2]!.trim()

      /*
       * Граница блока — повторение уже заполненной метки, а не
       * обязательно `Código`. Порядок полей в источнике не фиксирован,
       * замер дал четыре структуры:
       *   codigo,assunto,processo,interessad*  (основная, 262 блока)
       *   assunto,interessad*,processo
       *   processo,assunto,interessad*
       *   processo,assunto
       * Привязка к `Código` теряла бы три последних целиком.
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

    // Текст причины идёт после Interessado; всё, что раньше, — преамбула акта.
    if (draft?.interessado) draft.reasonParts.push(text)
  }

  if (draft !== null) push(draft)

  return { denials, unparsed }
}
