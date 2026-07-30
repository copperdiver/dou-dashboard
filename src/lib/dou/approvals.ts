import { cleanPersonName, normalizeProcessNumber, sha256Hex, stripDiacritics } from '../text'

/**
 * Разбор строк-персон в актах о присвоении гражданства.
 *
 * Формат по замеру на 515 строках:
 *   `ИМЯ - F009513-S, natural da Colômbia, nascido(a) em 7 de outubro de
 *    1979, filho(a) de X e de Y, residente no Estado do Paraná
 *    (Processo nº 235881.0423562/2023);`
 *
 * Поля извлекаются независимо друг от друга, а не одной монолитной
 * регуляркой: источник допускает пропуски (3 строки без даты рождения,
 * 2 без штата, 1 без номера процесса), и монолит терял бы такие строки
 * целиком вместо частичного разбора.
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
  /** Доля найденных полей: ниже 1 — часть данных в источнике отсутствует. */
  confidence: number
}

export type ApprovalExtraction = {
  people: ParsedApproval[]
  /** Абзацы, похожие на строку-персону, но не разобранные. Не теряем их. */
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

/** Абзац похож на строку-персону. */
const CANDIDATE = /natural\s+d/i

/**
 * Служебные абзацы акта, которые тоже содержат `natural d` или иначе
 * притворяются строкой-персоной.
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
  // Наблюдалось `nascido em`, `nascida em`, `nascido(a) em` и `nascida a`.
  const match = /nascid[oa](?:\(a\))?\s+(?:em|a)\s+(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/.exec(flat)
  if (!match) return { iso: null, raw: null }

  const day = Number.parseInt(match[1]!, 10)
  const month = MONTHS[match[2]!]
  const year = Number.parseInt(match[3]!, 10)

  const raw = `${match[1]} de ${match[2]} de ${match[3]}`
  if (!month || day < 1 || day > 31 || year < 1900 || year > 2100) return { iso: null, raw }

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  // Проверка на 31 февраля и подобное.
  const check = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== day) return { iso: null, raw }

  return { iso, raw }
}

function extractName(text: string): { name: string; documentId: string | null } | null {
  // Имя отделено от документа через ` - ` в 499 строках из 515.
  // Запятая после номера документа необязательна: наблюдалось
  // `GIANCARLO ENRIQUE MORA FLORES - V320840-8 natural do Equador`.
  // `RNM` перед номером написано словом лишь в 1 строке из 515, но без
  // этой альтернативы номер попадал прямо в имя.
  const dashed =
    /^\s*([^,]{2,120}?)\s+-\s+(?:RNM\s+)?([A-Za-z]?-?\d[\w.\-/]*)\s*(?:,|\s+natural\s)/i.exec(text)
  if (dashed) return { name: dashed[1]!.trim(), documentId: dashed[2]!.trim() }

  // Без документа: имя до `, natural`.
  const plain = /^\s*(.{2,120}?)\s*,\s*natural\s+d/i.exec(text)
  if (plain) return { name: plain[1]!.trim(), documentId: null }

  return null
}

function extractCountry(text: string): string | null {
  // Предлог: da(234) / do(219) / de(58) / dos(4). Шаблон `d[aeo]{1,2}s?`
  // покрывает и опечатку источника `natural doa Estados Unidos` —
  // без неё человек терялся целиком.
  const withBirth = /natural\s+d[aeo]{1,2}s?\s+([^,]{2,60}?)\s*,\s*nascid/i.exec(text)
  if (withBirth) return withBirth[1]!.trim()

  // Без запятой перед `nascid…`: наблюдалось `natural de Cuba nascida em
  // agosto de 1977` — без этой границы в страну попадала половина строки.
  const bare = /natural\s+d[aeo]{1,2}s?\s+([^,]{2,60}?)\s*(?:,|\.|;|\s+nascid|$)/i.exec(text)
  return bare ? bare[1]!.trim() : null
}

function extractState(text: string): string | null {
  // `residente no estado de São Paulo`(455) / `no Estado do Paraná`(53) /
  // `no Distrito Federal`(5) — регистр не значим.
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
 * Разбирает абзацы акта-одобрения.
 *
 * Абзац, похожий на строку-персону, но не поддавшийся разбору, попадает
 * в `unparsed`, а не выбрасывается: молчаливая потеря людей — худший
 * возможный отказ этого парсера.
 */
export function extractApprovals(paragraphs: readonly string[]): ApprovalExtraction {
  const people: ParsedApproval[] = []
  const unparsed: { text: string; reason: string }[] = []

  for (const text of paragraphs) {
    if (!CANDIDATE.test(text)) continue
    if (SKIP_PATTERNS.some((pattern) => pattern.test(text))) continue

    const named = extractName(text)
    if (!named) {
      unparsed.push({ text, reason: 'не выделено имя' })
      continue
    }

    const countryRaw = extractCountry(text)
    if (!countryRaw) {
      unparsed.push({ text, reason: 'не выделена страна рождения' })
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
      // Имя и страна уже есть, остальные четыре поля — необязательные.
      confidence: Number(((2 + present) / 6).toFixed(2)),
    })
  }

  return { people, unparsed }
}
