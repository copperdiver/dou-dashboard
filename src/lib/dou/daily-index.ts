/**
 * Parsing the daily index of a DOU edition.
 *
 * The `leiturajornal?data=DD-MM-YYYY&secao=do1` page returns HTML
 * containing a `<script id="params" type="application/json">` tag with
 * the list of all articles for the day (~300). This is the only
 * enumeration method that gives verifiable completeness: the list of days
 * is a checklist showing exactly what's missing. The search endpoint uses
 * cursor-based pagination (score + classPK via POST), and there's no way
 * to tell whether a record was dropped.
 */

export type DouIndexItem = {
  urlTitle: string
  title: string | null
  pubDate: string | null
  editionNumber: string | null
  numberPage: string | null
  artType: string | null
  pubOrder: number | null
  hierarchyStr: string | null
  content: string | null
}

export type DailyIndex = {
  items: DouIndexItem[]
}

/**
 * Extracts JSON from a tag by id. Boundaries are found by index, not
 * regex: the JSON contains curly braces, and balancing them with a regex
 * isn't reliable.
 */
export function extractScriptJson(html: string, id: string): unknown {
  const marker = `id="${id}"`
  const at = html.indexOf(marker)
  if (at === -1) return null

  const open = html.indexOf('>', at)
  if (open === -1) return null

  const close = html.indexOf('</script>', open)
  if (close === -1) return null

  const raw = html.slice(open + 1, close).trim()
  if (raw.length === 0) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * `null` means the markup changed (no params tag). This is not an empty
 * day: it's a signal that the source broke, and it must not be
 * silenced with retries.
 */
export function parseDailyIndex(html: string): DailyIndex | null {
  const params = extractScriptJson(html, 'params')
  if (params === null || typeof params !== 'object') return null

  const rawArray = (params as { jsonArray?: unknown }).jsonArray
  if (!Array.isArray(rawArray)) return null

  const items: DouIndexItem[] = []
  for (const entry of rawArray) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const urlTitle = asString(row.urlTitle)
    if (!urlTitle) continue

    items.push({
      urlTitle,
      title: asString(row.title),
      pubDate: asString(row.pubDate),
      editionNumber: asString(row.editionNumber),
      numberPage: asString(row.numberPage),
      artType: asString(row.artType),
      pubOrder: asInt(row.pubOrder),
      hierarchyStr: asString(row.hierarchyStr),
      content: asString(row.content),
    })
  }

  return { items }
}

/**
 * The issuing body's hierarchy: `Ministério da Justiça e Segurança
 * Pública/Secretaria Nacional de Justiça/Departamento de Migrações/...`.
 * The last segment varies. Observed: `Coordenação de Processos
 * Migratórios`, `Divisão de Naturalização, Nacionalidade e Apatridia`,
 * `Coordenação-Geral de Política Migratória`.
 */
const HIERARCHY_PATTERN = /Departamento de Migra|Processos Migrat|Naturaliza/i

/**
 * Labor migration sits in the same department but has nothing to do with
 * naturalization: these are work permits for companies
 * (`Requerente: ... LTDA`, `Prazo: 2 Anos`, `Imigrante: ...`).
 * One such page produced 548 paragraphs and 15 acts of pure noise, so
 * it's excluded before fetching, not after parsing.
 */
const HIERARCHY_EXCLUDE = /Imigra[çc][ãa]o Laboral/i

/**
 * A second, free filter: a keyword in the title or snippet. The
 * hierarchy filter can miss a relevant act from a different department,
 * and `content` is already in the index, so the filter can be broadened
 * later by reparsing snapshots, without hitting the network.
 */
const KEYWORD_PATTERN = /naturaliza|nacionalidade brasileira/i

export type Selection = 'hierarchy' | 'keyword' | 'both'

export type SelectedItem = DouIndexItem & { selectedBy: Selection }

/**
 * Selects relevant articles and records which signal matched.
 *
 * The hierarchy filter also catches irrelevant items (observed
 * `Coordenação-Geral de Imigração Laboral`, labor migration, not
 * naturalization), so `selectedBy` is kept: it lets reliable matches be
 * separated from stretched ones without losing data.
 */
export function selectRelevant(items: readonly DouIndexItem[]): SelectedItem[] {
  const selected: SelectedItem[] = []

  for (const item of items) {
    const hierarchy = item.hierarchyStr ?? ''
    if (HIERARCHY_EXCLUDE.test(hierarchy)) continue

    const byHierarchy = HIERARCHY_PATTERN.test(hierarchy)
    const byKeyword = KEYWORD_PATTERN.test(`${item.title ?? ''} ${item.content ?? ''}`)

    if (!byHierarchy && !byKeyword) continue

    selected.push({
      ...item,
      selectedBy: byHierarchy && byKeyword ? 'both' : byHierarchy ? 'hierarchy' : 'keyword',
    })
  }

  return selected
}

/** `29/07/2026` → `2026-07-29`. Returns null on an unexpected format. */
export function parsePubDate(pubDate: string | null): string | null {
  if (!pubDate) return null
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(pubDate.trim())
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}
