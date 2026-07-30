/**
 * Извлечение текстовых блоков со страницы статьи DOU.
 *
 * Разметка стабильна и проста: `<p class="identifica">` — заголовок акта,
 * `<p class="dou-paragraph">` — абзац, `<p class="assina">` — подпись.
 * JS для получения текста не нужен, кодировка UTF-8.
 */

export type BlockClass = 'identifica' | 'dou-paragraph' | 'assina' | 'cargo' | 'ementa' | 'other'

export type Block = {
  cls: BlockClass
  text: string
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  sect: '§',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, group: string) => {
    if (group.startsWith('#')) {
      const hex = group[1] === 'x' || group[1] === 'X'
      const code = Number.parseInt(hex ? group.slice(2) : group.slice(1), hex ? 16 : 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[group.toLowerCase()] ?? match
  })
}

function classOf(raw: string): BlockClass {
  const cls = raw.toLowerCase()
  if (cls.includes('identifica')) return 'identifica'
  if (cls.includes('dou-paragraph')) return 'dou-paragraph'
  if (cls.includes('assina')) return 'assina'
  if (cls.includes('cargo')) return 'cargo'
  if (cls.includes('ementa')) return 'ementa'
  return 'other'
}

/** Убирает теги, декодирует сущности, сводит пробелы. */
function toText(inner: string): string {
  return decodeEntities(
    inner
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PARAGRAPH_PATTERN = /<p\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/p>/gi

export function extractBlocks(html: string): Block[] {
  const blocks: Block[] = []

  for (const match of html.matchAll(PARAGRAPH_PATTERN)) {
    const cls = classOf(match[1] ?? '')
    if (cls === 'other') continue

    const text = toText(match[2] ?? '')
    if (text.length === 0) continue

    blocks.push({ cls, text })
  }

  return blocks
}

/**
 * Тело статьи вообще не распознано. Отличать это от «статья без актов»
 * важно: первое — сломанная разметка, второе — законная пустота.
 */
export function isEmptyPage(blocks: readonly Block[]): boolean {
  return blocks.length === 0
}
