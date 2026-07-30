/**
 * Атомарные причины отказа, распознаваемые детерминированными правилами.
 *
 * Сидируются с переводами, написанными руками, а не полученными от LLM:
 * это самые частые причины (покрывают ~82% текстов), и точность их
 * формулировок важнее, чем экономия на ручной работе. LLM остаётся
 * для остатка ~18%, где заранее известного списка нет.
 *
 * `slug` совпадает с кодом правила в канонизаторе — связь правило ↔
 * причина не требует отдельной таблицы соответствий.
 *
 * Частоты в комментариях — по замеру на 355 текстах причин.
 */
export type ReasonSeed = {
  slug: string
  categoryCode: string
  textPt: string
  textEn: string
  textRu: string
}

export const REASON_SEED: readonly ReasonSeed[] = [
  {
    // 41% текстов
    slug: 'criminal_record',
    categoryCode: 'criminal_record',
    textPt: 'Não apresentou certidões de antecedentes criminais da Justiça Estadual e Federal',
    textEn: 'Did not provide state and federal criminal record certificates',
    textRu: 'Не предоставил справки о судимости из федеральной и штатной юстиции',
  },
  {
    // 31%
    slug: 'portuguese',
    categoryCode: 'language',
    textPt: 'Não comprovou capacidade de se comunicar em língua portuguesa',
    textEn: 'Did not prove the ability to communicate in Portuguese',
    textRu: 'Не подтвердил способность общаться на португальском языке',
  },
  {
    // 23%
    slug: 'deadline_no_reply',
    categoryCode: 'deadlines',
    textPt: 'Não respondeu às exigências dentro do prazo previsto',
    textEn: 'Did not respond to the requirements within the deadline',
    textRu: 'Не ответил на требования в установленный срок',
  },
  {
    // 20%
    slug: 'residence_proof',
    categoryCode: 'residence',
    textPt: 'Não apresentou comprovante de residência',
    textEn: 'Did not provide proof of residence',
    textRu: 'Не предоставил подтверждение места проживания',
  },
  {
    // 15%
    slug: 'residence_period',
    categoryCode: 'residence',
    textPt: 'Não cumpriu o prazo mínimo de residência exigido',
    textEn: 'Did not meet the minimum required period of residence',
    textRu: 'Не выполнил требование о минимальном сроке проживания',
  },
  {
    // 15%
    slug: 'travel_doc',
    categoryCode: 'documents',
    textPt: 'Não apresentou documento de viagem internacional válido',
    textEn: 'Did not provide a valid international travel document',
    textRu: 'Не предоставил действующий международный документ для поездок',
  },
  {
    // 9%
    slug: 'no_show',
    categoryCode: 'no_show',
    textPt: 'Não compareceu quando convocado',
    textEn: 'Did not appear when summoned',
    textRu: 'Не явился по вызову',
  },
  {
    // 9%
    slug: 'wrong_track',
    categoryCode: 'eligibility',
    textPt: 'Não se enquadra na modalidade de naturalização requerida',
    textEn: 'Does not qualify for the requested naturalization track',
    textRu: 'Не подходит под запрошенный вид натурализации',
  },
  {
    // 6%
    slug: 'cpf',
    categoryCode: 'documents',
    textPt: 'Não apresentou comprovante de situação cadastral do CPF',
    textEn: 'Did not provide proof of CPF registration status',
    textRu: 'Не предоставил справку о состоянии учётной записи CPF',
  },
  {
    // 1%
    slug: 'minor_capacity',
    categoryCode: 'eligibility',
    textPt: 'Não possui capacidade civil segundo a lei brasileira (menor de idade)',
    textEn: 'Lacks civil capacity under Brazilian law (minor)',
    textRu: 'Не обладает гражданской дееспособностью по бразильскому праву (несовершеннолетний)',
  },

  /*
   * Две расплывчатые формулировки. Встречаются часто (37% и 23%), но
   * конкретного требования не называют, поэтому отнесены к «Неясно»:
   * иначе в bar chart они заняли бы верхние места, ничего не объясняя.
   */
  {
    slug: 'requirements_generic',
    categoryCode: 'unclear',
    textPt: 'Não cumprimento das exigências legais, sem especificação',
    textEn: 'Non-compliance with legal requirements, unspecified',
    textRu: 'Неисполнение требований закона, без уточнения',
  },
  {
    slug: 'docs_generic',
    categoryCode: 'unclear',
    textPt: 'Não apresentou os documentos necessários, sem especificação',
    textEn: 'Did not provide the required documents, unspecified',
    textRu: 'Не предоставил необходимые документы, без уточнения',
  },
] as const
