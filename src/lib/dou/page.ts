/**
 * Extracting text blocks from a DOU article page.
 *
 * The markup is stable and simple: `<p class="identifica">` is the act's
 * header, `<p class="dou-paragraph">` is a paragraph, `<p class="assina">`
 * is a signature. No JS execution needed to get the text, encoding is
 * UTF-8.
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

/** Strips tags, decodes entities, collapses whitespace. */
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
 * The article body wasn't recognized at all. Distinguishing this from
 * "article with no acts" matters: the former is broken markup, the
 * latter is legitimate emptiness.
 */
export function isEmptyPage(blocks: readonly Block[]): boolean {
  return blocks.length === 0
}
