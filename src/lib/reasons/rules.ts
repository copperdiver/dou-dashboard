/**
 * Детерминированные правила распознавания атомарных причин отказа.
 *
 * Правила живут в коде, а не в БД: их надо ревьюить, тестировать на
 * фикстурах и откатывать. Таблица паттернов в базе звучит гибко, но
 * превращается в неверсионируемый недоязык без тестов. В БД попадает
 * только результат применения (`rule_code`, `rules_version`).
 *
 * Паттерны написаны БЕЗ диакритики: они применяются к нормализованному
 * тексту (см. normalize.ts).
 *
 * Замер на 355 текстах: правила ниже покрывают 78%, вместе с декодером
 * правовых ссылок — 82%. Остаток идёт в LLM.
 */

/** Увеличивать при любом изменении правил: тексты переразберутся. */
export const RULES_VERSION = 1

type Rule = {
  code: string
  /** Совпадает со slug атомарной причины в справочнике. */
  slug: string
  pattern: RegExp
  /** Частота по замеру, для читаемости порядка. */
  note?: string
}

/*
 * Порядок в массиве ни на что не влияет — применяются все правила.
 * Квантификаторы не вложены: один Worker обслуживает и разбор, и
 * загрузку, поэтому катастрофический backtracking заморозил бы конвейер.
 */
const RULES: readonly Rule[] = [
  {
    code: 'R01',
    slug: 'criminal_record',
    pattern: /antecedentes criminais|certid\w{0,4} de antecedentes/g,
    note: '41%',
  },
  {
    code: 'R02',
    slug: 'portuguese',
    // `comunicacao em portugues` не ловился первой версией правила —
    // 15 текстов уходили в LLM без нужды.
    pattern: /lingua portuguesa|comunica\w{0,4} em portugu\w{0,3}/g,
    note: '31%',
  },
  {
    code: 'R03',
    slug: 'deadline_no_reply',
    pattern: /nao respondeu|dentro do prazo|prazo previsto|nao se manifestou/g,
    note: '23%',
  },
  {
    code: 'R04',
    slug: 'residence_proof',
    // И `comprovante`, и `comprovacao` — вторая форма терялась.
    pattern: /comprova\w{0,4} de resid\w{0,5}|comprovante de endere\w{0,2}/g,
    note: '20%',
  },
  {
    code: 'R05',
    slug: 'residence_period',
    pattern: /prazo minimo exig\w{0,4}|prazo de resid\w{0,5}|residencia por prazo/g,
    note: '15%',
  },
  {
    code: 'R06',
    slug: 'travel_doc',
    pattern: /documento de viagem|passaporte/g,
    note: '15%',
  },
  {
    code: 'R07',
    slug: 'no_show',
    pattern: /nao compareceu/g,
    note: '9%',
  },
  {
    code: 'R08',
    slug: 'wrong_track',
    pattern: /nao se enquadra ness[ea] modelo/g,
    note: '9%',
  },
  {
    code: 'R09',
    slug: 'cpf',
    pattern: /\bcpf\b/g,
    note: '6%',
  },
  {
    code: 'R10',
    slug: 'minor_capacity',
    pattern: /menor de idade|capacidade civil/g,
    note: '1%',
  },
  {
    code: 'R11',
    slug: 'docs_generic',
    pattern: /nao apresentou os documentos/g,
    note: '23%, расплывчато → категория «Неясно»',
  },
  {
    code: 'R12',
    slug: 'requirements_generic',
    pattern: /nao cumprimento das exigencias/g,
    note: '37%, расплывчато → категория «Неясно»',
  },
]

export type RuleMatch = {
  slug: string
  ruleCode: string
  /** Координаты в нормализованном тексте. */
  start: number
  end: number
}

/** Применяет все правила к нормализованному тексту начиная с `from`. */
export function applyRules(normalizedText: string, from = 0): RuleMatch[] {
  const matches: RuleMatch[] = []
  const haystack = normalizedText.slice(from)

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    for (const match of haystack.matchAll(rule.pattern)) {
      const start = from + (match.index ?? 0)
      matches.push({
        slug: rule.slug,
        ruleCode: rule.code,
        start,
        end: start + match[0].length,
      })
    }
  }

  return matches.sort((a, b) => a.start - b.start)
}

/** Объединяет пересекающиеся спаны. */
export function mergeSpans(
  spans: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
  if (spans.length === 0) return []

  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = [{ ...sorted[0]! }]

  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1]!
    if (span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }

  return merged
}

/**
 * Доля содержательного текста, покрытая спанами. Метрика качества:
 * её падение на новых данных означает, что источник сменил формулировки
 * и правила молча перестали срабатывать.
 */
export function coveredCharRatio(
  spans: readonly { start: number; end: number }[],
  from: number,
  total: number,
): number {
  const length = total - from
  if (length <= 0) return 0
  const covered = mergeSpans(spans).reduce(
    (sum, span) => sum + (Math.min(span.end, total) - Math.max(span.start, from)),
    0,
  )
  return Math.min(1, Math.max(0, covered / length))
}

export const RULE_CODES = RULES.map((r) => ({ code: r.code, slug: r.slug, note: r.note }))
