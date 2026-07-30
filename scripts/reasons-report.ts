/**
 * Прогоняет канонизатор причин по реальным текстам из БД и печатает,
 * что покрыли правила и что осталось для LLM.
 *
 *   npx tsx --env-file-if-exists=.env scripts/reasons-report.ts
 *   npx tsx --env-file-if-exists=.env scripts/reasons-report.ts --show-remainder
 *
 * Ничего не пишет. Нужно, чтобы правки правил были видны до того, как
 * попадут в данные, и чтобы отследить падение покрытия при смене
 * формулировок в источнике.
 */
import { isNotNull } from 'drizzle-orm'
import { closePool, db } from '../src/db/client'
import { acts, sourcePageHtml, sourcePages } from '../src/db/schema'
import { extractDenials } from '../src/lib/dou/denials'
import { analyzeReasonText } from '../src/lib/reasons/canonize'
import { RULE_CODES } from '../src/lib/reasons/rules'

const showRemainder = process.argv.includes('--show-remainder')

try {
  // Берём тексты из разобранных актов, а не из denials: текст причины
  // хранится в reason_texts, которые ещё не заполнены.
  const rows = await db
    .select({ paragraphs: acts.paragraphs, kind: acts.actKind })
    .from(acts)
    .where(isNotNull(acts.paragraphs))

  const texts: string[] = []
  for (const row of rows) {
    if (row.kind !== 'denial_list') continue
    for (const denial of extractDenials(row.paragraphs).denials) {
      if (denial.reasonText && denial.reasonText.length > 120) texts.push(denial.reasonText)
    }
  }

  if (texts.length === 0) {
    console.log('Текстов причин в БД нет — сначала загрузите и разберите страницы.')
  } else {
    const bySlug = new Map<string, number>()
    const byMethod = new Map<string, number>()
    const perTextCounts = new Map<number, number>()
    const unique = new Set<string>()
    const remainders: string[] = []
    let covered = 0
    let ratioSum = 0

    for (const text of texts) {
      const analysis = analyzeReasonText(text)
      unique.add(analysis.normSha256)
      ratioSum += analysis.coveredCharRatio

      const slugs = new Set(analysis.matches.map((m) => m.slug))
      if (slugs.size > 0) covered += 1
      else remainders.push(analysis.remainder || text)

      perTextCounts.set(slugs.size, (perTextCounts.get(slugs.size) ?? 0) + 1)
      for (const m of analysis.matches) {
        bySlug.set(m.slug, (bySlug.get(m.slug) ?? 0) + 1)
        byMethod.set(m.method, (byMethod.get(m.method) ?? 0) + 1)
      }
      if (analysis.remainder.length > 0 && slugs.size > 0) {
        // Частично покрытые тоже интересны: остаток пойдёт в LLM.
        remainders.push(analysis.remainder)
      }
    }

    const total = texts.length
    console.log(`текстов: ${total}, уникальных после нормализации: ${unique.size}`)
    console.log(
      `покрыто хотя бы одной причиной: ${covered} (${((100 * covered) / total).toFixed(0)}%) → ` +
        `в LLM: ${total - covered} (${((100 * (total - covered)) / total).toFixed(0)}%)`,
    )
    console.log(`средняя доля покрытого текста: ${(ratioSum / total).toFixed(3)}`)

    console.log('\nпо способу определения:', Object.fromEntries(byMethod))

    console.log('\nчастоты атомарных причин:')
    for (const [slug, count] of [...bySlug.entries()].sort((a, b) => b[1] - a[1])) {
      const rule = RULE_CODES.find((r) => r.slug === slug)
      console.log(
        `  ${String(count).padStart(4)} (${String(Math.round((100 * count) / total)).padStart(3)}%)  ${slug.padEnd(22)} ${rule?.note ?? ''}`,
      )
    }

    console.log(
      '\nпричин в одном тексте:',
      Object.fromEntries([...perTextCounts.entries()].sort((a, b) => a[0] - b[0])),
    )

    if (showRemainder) {
      console.log(`\nостатки для LLM (${remainders.length}), первые 12:`)
      for (const r of remainders.slice(0, 12)) console.log(`  • ${r.slice(0, 200)}`)
    }
  }
} catch (error) {
  console.error('Ошибка:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
