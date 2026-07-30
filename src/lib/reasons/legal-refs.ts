/**
 * Декодер правовых ссылок.
 *
 * Ссылка на статью — это КОНТЕКСТ, а не причина: `art. 65` встречается
 * в 74% текстов отказа, и будь он причиной, крупнейшая категория графика
 * оказалась бы пустой по смыслу и утопила бы остальные.
 *
 * Но у ссылки есть декодируемая часть: номер `inciso` называет конкретное
 * требование закона. Часть текстов существо отказа словами не описывает
 * вовсе — только цитирует статью с инцизами, и без этого декодера они
 * уходили бы в LLM без нужды.
 *
 * Сопоставления ниже включены только там, где смысл подтверждён и текстом
 * закона, и наблюдавшимися формулировками. Спорное не угадывается —
 * непокрытое честно уходит в LLM.
 */

export type LegalRef = {
  /** `art.65`, `art.234`. */
  article: string
  /** Римский номер инциза как в тексте: `II`. */
  inciso: string | null
  /** Slug атомарной причины, если инциз декодируется. */
  slug: string | null
  start: number
  end: number
}

/**
 * Lei 13.445/2017, art. 65 — требования обычной натурализации.
 * Подтверждено наблюдавшимися текстами: `inciso I` встречается вместе
 * с «é menor de idade ... capacidade civil», `inciso III` — с
 * «comunicação em português».
 */
const ART_65: Record<string, string> = {
  I: 'minor_capacity',
  II: 'residence_period',
  III: 'portuguese',
  IV: 'criminal_record',
}

/**
 * Decreto 9.199/2017, art. 234 — повторяет требования ст. 65 Закона.
 * Наблюдалось `art. 234, incisos II, III e IV` в паре с текстом про
 * подтверждение адреса, португальский язык и справки о судимости.
 * Инциз V встречался, но его смысл не подтверждён — не сопоставляем.
 */
const ART_234: Record<string, string> = {
  I: 'minor_capacity',
  II: 'residence_period',
  III: 'portuguese',
  IV: 'criminal_record',
}

/**
 * Decreto 9.199/2017, art. 245 — состав документов заявления.
 * Наблюдалось `Art. 245, I do Decreto 9.199/2017` вместе с
 * «não apresentou o(s) documento(s)», поэтому инциз I сопоставлен
 * с общей формулировкой о непредставленных документах.
 */
const ART_245: Record<string, string> = {
  I: 'docs_generic',
}

const ARTICLE_INCISOS: Record<string, Record<string, string>> = {
  'art.65': ART_65,
  'art.234': ART_234,
  'art.245': ART_245,
}

const ROMAN = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x)$/

/** Разбирает перечисление римских номеров: `ii, iii e iv`. */
function parseIncisos(raw: string): string[] {
  return raw
    .split(/\s*(?:,|\be\b)\s*/)
    .map((part) => part.trim())
    .filter((part) => ROMAN.test(part))
    .map((part) => part.toUpperCase())
}

/*
 * Три порядка следования, все наблюдались:
 *   art. 65, incisos II, III e IV
 *   incisos II, III e IV do art. 65
 *   Art. 245, I do Decreto
 * Квантификаторы ограничены сверху и не вложены — на абзаце в 4000
 * символов регулярка не должна уходить в катастрофический backtracking,
 * потому что один Worker обслуживает и разбор, и загрузку.
 */
/*
 * Римское число как единый класс `[ivx]{1,4}\b`, а НЕ альтернация
 * `i{1,3}|iv|v|...`: в альтернации `i{1,3}` пробуется первой, на входе
 * `inciso iv` она матчит одну `i`, и дальше ничего не требует дочитать
 * число до конца. Так `IV` разбирался как `I` — и «нет справок
 * о судимости» превращалось в «несовершеннолетний» в 32% текстов
 * вместо замеренного 1%. Проверку корректности числа делает parseIncisos.
 */
const ROMAN_LIST = String.raw`[ivx]{1,4}\b(?:\s*(?:,|e)\s*[ivx]{1,4}\b)*`

const PATTERNS: readonly { re: RegExp; articleGroup: number; incisoGroup: number }[] = [
  {
    re: new RegExp(String.raw`art\.?\s*(\d{1,3})[^.;]{0,80}?incisos?\s+(${ROMAN_LIST})`, 'g'),
    articleGroup: 1,
    incisoGroup: 2,
  },
  {
    re: new RegExp(String.raw`incisos?\s+(${ROMAN_LIST})[^.;]{0,60}?art\.?\s*(\d{1,3})`, 'g'),
    articleGroup: 2,
    incisoGroup: 1,
  },
  {
    re: new RegExp(String.raw`art\.?\s*(\d{1,3}),\s*(${ROMAN_LIST})\s+d[aeo]\b`, 'g'),
    articleGroup: 1,
    incisoGroup: 2,
  },
]

/** Все упоминания статей — для `reason_texts.legal_refs`. */
const ARTICLE_ONLY = /art(?:s?\.|igos?)\s*(\d{1,3})/g

/**
 * Разбирает правовые ссылки в НОРМАЛИЗОВАННОМ тексте.
 *
 * Возвращает и декодированные инцизы (со slug), и упоминания статей без
 * инцизов (slug = null) — вторые идут в контекст, а не в причины.
 */
export function extractLegalRefs(normalizedText: string): LegalRef[] {
  const refs: LegalRef[] = []
  const seen = new Set<string>()

  for (const { re, articleGroup, incisoGroup } of PATTERNS) {
    re.lastIndex = 0
    for (const match of normalizedText.matchAll(re)) {
      const article = `art.${match[articleGroup]}`
      const table = ARTICLE_INCISOS[article]
      const start = match.index ?? 0
      const end = start + match[0].length

      for (const inciso of parseIncisos(match[incisoGroup] ?? '')) {
        const key = `${article}:${inciso}`
        if (seen.has(key)) continue
        seen.add(key)
        refs.push({ article, inciso, slug: table?.[inciso] ?? null, start, end })
      }
    }
  }

  // Статьи без инцизов — только как контекст.
  ARTICLE_ONLY.lastIndex = 0
  for (const match of normalizedText.matchAll(ARTICLE_ONLY)) {
    const article = `art.${match[1]}`
    if ([...seen].some((key) => key.startsWith(`${article}:`))) continue
    if (seen.has(article)) continue
    seen.add(article)
    refs.push({
      article,
      inciso: null,
      slug: null,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    })
  }

  return refs.sort((a, b) => a.start - b.start)
}

/** Строки для `reason_texts.legal_refs`: `art.65:III` либо `art.221`. */
export function formatLegalRefs(refs: readonly LegalRef[]): string[] {
  return [...new Set(refs.map((r) => (r.inciso ? `${r.article}:${r.inciso}` : r.article)))].sort()
}
