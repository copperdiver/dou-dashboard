/**
 * Нормализация текста причины отказа с сохранением смещений и разбиение
 * на клаузы.
 *
 * Смещения нужны не для красоты: правила возвращают спаны-доказательства,
 * по ним считается доля покрытого текста, и — главное — в LLM уходит
 * только непокрытый остаток, а не весь текст. Без обратного отображения
 * в исходные координаты подсветить доказательство было бы нечем.
 */

export type Normalized = {
  /** Без диакритики, в нижнем регистре, одиночные пробелы. */
  text: string
  /** map[i] — индекс символа в исходной строке, породившего text[i]. */
  map: number[]
}

/**
 * Строит нормализованную строку и отображение обратно в исходные индексы.
 *
 * Диакритика снимается через NFD: `ã` → `a` + combining tilde, вторая
 * часть выбрасывается. Длина строки при этом меняется, поэтому наивный
 * `indexOf` в нормализованном тексте не дал бы позицию в исходном.
 */
export function normalizeWithMap(raw: string): Normalized {
  const chars: string[] = []
  const map: number[] = []
  let pendingSpace = false

  for (let i = 0; i < raw.length; i += 1) {
    const source = raw[i]!

    if (/\s/.test(source)) {
      // Пробельный прогон сжимается в один пробел; ведущие отбрасываются.
      if (chars.length > 0) pendingSpace = true
      continue
    }

    if (pendingSpace) {
      chars.push(' ')
      map.push(i)
      pendingSpace = false
    }

    for (const part of source.normalize('NFD')) {
      // Combining marks (U+0300..U+036F и прочие) выбрасываем.
      if (/\p{Mn}/u.test(part)) continue
      chars.push(part.toLowerCase())
      map.push(i)
    }
  }

  return { text: chars.join(''), map }
}

/** Переводит спан в нормализованных координатах в исходные. */
export function toRawSpan(
  normalized: Normalized,
  start: number,
  end: number,
): { start: number; end: number } {
  const rawStart = normalized.map[start] ?? 0
  // end указывает за последний символ, поэтому берём отображение
  // последнего входящего и добавляем единицу.
  const lastIndex = Math.max(start, end - 1)
  const rawEnd = (normalized.map[lastIndex] ?? rawStart) + 1
  return { start: rawStart, end: rawEnd }
}

/**
 * Преамбула, присутствующая почти в каждом тексте причины. Смысла не
 * несёт, но забивает и похожесть, и промпт LLM.
 *
 * Возвращает позицию в НОРМАЛИЗОВАННОМ тексте, с которой начинается
 * содержательная часть.
 */
/*
 * Голова преамбулы: должность плюс формула о полномочиях. Наблюдались
 * `A COORDENADORA DE PROCESSOS MIGRATÓRIOS, no uso da competência
 * delegada pela Portaria nº 623...` и `O CHEFE DA DIVISÃO ..., no uso
 * de suas atribuições legais`.
 */
const PREAMBLE_HEAD =
  /^[ao]\s+(?:coordenador[ae]?|chefe|dirigente)\b[\s\S]{0,300}?(?:competencia\s+delegada|atribui\w+\s+lega\w+)/

/**
 * Начало содержательной части: глагол решения либо оборот, вводящий
 * основание. Привязка к ним, а не к подсчёту запятых: в преамбуле запятых
 * несколько (номер портарии, дата, дата публикации), и шаблон вида
 * `[^,]*,` обрывался на первой из них, оставляя половину преамбулы
 * в тексте причины.
 */
const SUBSTANCE =
  /\b(?:indefere|indeferir|indeferido|defere|deferir|considerando|resolve|declara|declarar|arquivar|arquivamento|tendo em vista|em razao|por descumprimento|nos termos)\b/

export function preambleEnd(normalizedText: string): number {
  const head = PREAMBLE_HEAD.exec(normalizedText)
  if (!head) return 0

  const rest = normalizedText.slice(head[0].length)
  const substance = SUBSTANCE.exec(rest)
  // Голова есть, а содержательного маркера нет — режем только голову,
  // чтобы не выбросить весь текст.
  return substance ? head[0].length + substance.index : head[0].length
}

/** Маскирует цифровые серии: номера законов, статей и дат смысла не несут. */
export function maskDigits(value: string): string {
  return value.replace(/\d+/g, '#')
}

/**
 * Ключ дедупликации текста причины.
 *
 * Дешёвый и НЕ зависящий от версии правил: его считает парсер при
 * создании `reason_texts`, чтобы одинаковые тексты не заводились дважды.
 * Замер: 267 текстов сворачиваются в 203 уникальных, а правила и LLM
 * работают по уникальным, а не по каждому отказу.
 *
 * Единственная реализация нормализации в проекте — все, кому нужен этот
 * ключ, зовут её, а не повторяют логику.
 */
export function reasonDedupKey(raw: string): { textNorm: string; normSha256Input: string } {
  const normalized = normalizeWithMap(raw)
  const textNorm = maskDigits(normalized.text.slice(preambleEnd(normalized.text))).trim()
  return { textNorm, normSha256Input: textNorm }
}

export type Clause = {
  text: string
  /** Координаты в нормализованном тексте. */
  start: number
  end: number
}

/**
 * Сокращения, после точки в которых предложение НЕ заканчивается.
 * Без этой защиты `art. 65` рвался бы на две клаузы, и правило,
 * опирающееся на номер статьи вместе с inciso, перестало бы срабатывать.
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
  // Одиночная буква или цифра — почти всегда инициал или номер.
  if (token.length === 1) return true
  if (/^\d+$/.test(token)) return true
  return ABBREVIATIONS.has(token)
}

/**
 * Режет нормализованный текст на клаузы.
 *
 * Границы: `;`, перечислительное ` e `, и `. ` с защитой от сокращений.
 * Клаузы нужны, чтобы правила и похожесть работали по смысловым
 * фрагментам: похожесть по полному тексту делает все тексты похожими
 * из-за общего юридического бойлерплейта.
 */
export function segmentClauses(normalizedText: string, from = 0): Clause[] {
  const clauses: Clause[] = []
  let start = from

  const push = (end: number) => {
    const text = normalizedText.slice(start, end).trim()
    if (text.length >= 3) {
      // Пересчитываем границы после trim, чтобы спаны не включали пробелы.
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

    // Перечислительное ` e ` — граница только если по обе стороны
    // достаточно текста, иначе рвутся имена вида `X e Y`.
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
