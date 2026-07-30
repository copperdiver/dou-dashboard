/**
 * Разведка форматов в уже загруженных страницах: какие метки, какие
 * значения Assunto и какие формы номеров процесса встречаются.
 *
 *   npx tsx --env-file-if-exists=.env scripts/survey-blocks.ts
 *
 * Нужно, чтобы правила парсера опирались на измерение, а не на догадку,
 * и чтобы после расширения бэкфилла увидеть новые формы.
 */
import { eq } from 'drizzle-orm'
import { closePool, db } from '../src/db/client'
import { sourcePageHtml, sourcePages } from '../src/db/schema'
import { extractBlocks } from '../src/lib/dou/page'

function top<K>(counts: Map<K, number>, limit: number): [K, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

function bump<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

try {
  const pages = await db
    .select({ html: sourcePageHtml.html })
    .from(sourcePages)
    .innerJoin(sourcePageHtml, eq(sourcePageHtml.pageId, sourcePages.id))

  const paragraphs = pages.flatMap((p) =>
    extractBlocks(p.html)
      .filter((b) => b.cls === 'dou-paragraph')
      .map((b) => b.text),
  )

  console.log(`страниц ${pages.length}, абзацев ${paragraphs.length}\n`)

  const labels = new Map<string, number>()
  const assuntos = new Map<string, number>()
  const shapes = new Map<string, number>()

  for (const text of paragraphs) {
    const label = /^([A-Za-zÀ-ÿ]{4,14})\s*:/.exec(text)
    if (label) bump(labels, label[1]!)

    const assunto = /^Assunto\s*:\s*(.*)$/i.exec(text)
    if (assunto) bump(assuntos, assunto[1]!.trim())

    for (const match of text.matchAll(/\b\d[\d.\/-]{8,26}\b/g)) {
      bump(shapes, match[0].replace(/\d/g, '#'))
    }
  }

  console.log('Метки в начале абзаца:')
  for (const [k, v] of top(labels, 12)) console.log(`  ${String(v).padStart(5)}  ${k}`)

  console.log('\nЗначения Assunto:')
  for (const [k, v] of top(assuntos, 16)) console.log(`  ${String(v).padStart(5)}  ${k.slice(0, 90)}`)

  console.log('\nФормы номеров (цифры маскированы):')
  for (const [k, v] of top(shapes, 10)) console.log(`  ${String(v).padStart(5)}  ${k}`)

  // Последовательность меток внутри страницы: показывает, какие структуры
  // блоков реально встречаются, а не только какие метки есть.
  const sequences = new Map<string, number>()
  const strayProcesso: string[] = []

  for (const page of pages) {
    const texts = extractBlocks(page.html)
      .filter((b) => b.cls === 'dou-paragraph')
      .map((b) => b.text)

    const seq: string[] = []
    for (let i = 0; i < texts.length; i += 1) {
      const label = /^(C[oó]digo|Assunto|Processo|Interessad[oa])\s*[:nº]/i.exec(texts[i]!)
      if (!label) continue
      const key = label[1]!.toLowerCase().replace('ó', 'o').replace(/interessad[oa]/, 'interessad*')
      seq.push(key)

      if (key === 'processo') {
        const prev = seq[seq.length - 2]
        if (prev !== 'assunto' && strayProcesso.length < 6) strayProcesso.push(texts[i]!.slice(0, 120))
      }
    }

    // Сжимаем в повторяющийся шаблон: ищем период последовательности.
    const compact = seq.join(',')
    for (let period = 1; period <= 5; period += 1) {
      const unit = seq.slice(0, period).join(',')
      if (unit.length === 0) continue
      const repeated = Array.from({ length: Math.ceil(seq.length / period) }, () => unit)
        .join(',')
        .slice(0, compact.length)
      if (repeated === compact) {
        bump(sequences, `${unit}  ×${Math.round(seq.length / period)}`)
        break
      }
      if (period === 5) bump(sequences, `нерегулярно (${seq.length} меток): ${compact.slice(0, 60)}…`)
    }
  }

  console.log('\nСтруктуры блоков по страницам:')
  for (const [k, v] of top(sequences, 12)) console.log(`  ${String(v).padStart(3)} стр.  ${k}`)

  console.log('\nПримеры «Processo» не после Assunto:')
  for (const s of strayProcesso) console.log(`  ${s}`)
} catch (error) {
  console.error('Ошибка:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
