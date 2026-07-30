/**
 * Разбор дневного индекса выпуска DOU.
 *
 * Страница `leiturajornal?data=DD-MM-YYYY&secao=do1` отдаёт HTML, внутри
 * которого лежит `<script id="params" type="application/json">` со списком
 * всех статей дня (~300). Это единственный способ перечисления, дающий
 * проверяемую полноту: список дней — чек-лист, где видно, что пропущено.
 * У поискового эндпоинта пагинация курсорная (score + classPK через POST),
 * и по ней нельзя узнать, потеряна ли запись.
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
 * Достаёт JSON из тега по id. Границы ищутся индексами, а не регуляркой:
 * внутри JSON есть фигурные скобки, и балансировать их регуляркой
 * ненадёжно.
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
 * `null` — разметка изменилась (нет тега params). Это не пустой день,
 * а сигнал, что источник сломался, и его нельзя глушить ретраями.
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
 * Иерархия органа: `Ministério da Justiça e Segurança Pública/Secretaria
 * Nacional de Justiça/Departamento de Migrações/...`. Последний сегмент
 * различается — наблюдались `Coordenação de Processos Migratórios`,
 * `Divisão de Naturalização, Nacionalidade e Apatridia`,
 * `Coordenação-Geral de Política Migratória`.
 */
const HIERARCHY_PATTERN = /Departamento de Migra|Processos Migrat|Naturaliza/i

/**
 * Второй, бесплатный фильтр: ключевое слово в заголовке или сниппете.
 * Иерархия может пропустить релевантный акт другого департамента, а
 * `content` в индексе уже есть — расширять фильтр позже можно
 * переразбором снапшотов, без обращения к сети.
 */
const KEYWORD_PATTERN = /naturaliza|nacionalidade brasileira/i

export type Selection = 'hierarchy' | 'keyword' | 'both'

export type SelectedItem = DouIndexItem & { selectedBy: Selection }

/**
 * Отбирает релевантные статьи и фиксирует, каким признаком.
 *
 * Иерархия ловит и нерелевантное (наблюдалась `Coordenação-Geral de
 * Imigração Laboral` — трудовая миграция, не натурализация), поэтому
 * `selectedBy` хранится: по нему можно отделить надёжные совпадения
 * от притянутых, не теряя данные.
 */
export function selectRelevant(items: readonly DouIndexItem[]): SelectedItem[] {
  const selected: SelectedItem[] = []

  for (const item of items) {
    const byHierarchy = HIERARCHY_PATTERN.test(item.hierarchyStr ?? '')
    const byKeyword = KEYWORD_PATTERN.test(`${item.title ?? ''} ${item.content ?? ''}`)

    if (!byHierarchy && !byKeyword) continue

    selected.push({
      ...item,
      selectedBy: byHierarchy && byKeyword ? 'both' : byHierarchy ? 'hierarchy' : 'keyword',
    })
  }

  return selected
}

/** `29/07/2026` → `2026-07-29`. Возвращает null на неожидаемом формате. */
export function parsePubDate(pubDate: string | null): string | null {
  if (!pubDate) return null
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(pubDate.trim())
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}
