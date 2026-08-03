/**
 * Format reconnaissance over already-fetched pages: which labels, which
 * Assunto values, and which process-number shapes show up.
 *
 *   npx tsx --env-file-if-exists=.env scripts/survey-blocks.ts
 *
 * Needed so parser rules are based on measurement rather than guesswork,
 * and to spot new shapes after expanding the backfill.
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

  console.log(`pages ${pages.length}, paragraphs ${paragraphs.length}\n`)

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

  console.log('Labels at the start of a paragraph:')
  for (const [k, v] of top(labels, 12)) console.log(`  ${String(v).padStart(5)}  ${k}`)

  console.log('\nAssunto values:')
  for (const [k, v] of top(assuntos, 16)) console.log(`  ${String(v).padStart(5)}  ${k.slice(0, 90)}`)

  console.log('\nNumber shapes (digits masked):')
  for (const [k, v] of top(shapes, 10)) console.log(`  ${String(v).padStart(5)}  ${k}`)

  // Label sequence within a page: shows which block structures actually
  // occur, not just which labels exist.
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

    // Compress into a repeating pattern: look for the sequence's period.
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
      if (period === 5) bump(sequences, `irregular (${seq.length} labels): ${compact.slice(0, 60)}…`)
    }
  }

  console.log('\nBlock structures by page:')
  for (const [k, v] of top(sequences, 12)) console.log(`  ${String(v).padStart(3)} pg.  ${k}`)

  console.log('\nExamples of "Processo" not after Assunto:')
  for (const s of strayProcesso) console.log(`  ${s}`)
} catch (error) {
  console.error('Error:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
