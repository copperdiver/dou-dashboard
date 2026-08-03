/**
 * Runs the reason canonizer over real texts from the DB and prints what
 * the rules covered and what's left for the LLM.
 *
 *   npx tsx --env-file-if-exists=.env scripts/reasons-report.ts
 *   npx tsx --env-file-if-exists=.env scripts/reasons-report.ts --show-remainder
 *
 * Writes nothing. Needed to see the effect of rule changes before they
 * hit the data, and to catch coverage drops when the source's wording
 * changes.
 */
import { isNotNull } from 'drizzle-orm'
import { closePool, db } from '../src/db/client'
import { acts, sourcePageHtml, sourcePages } from '../src/db/schema'
import { extractDenials } from '../src/lib/dou/denials'
import { analyzeReasonText } from '../src/lib/reasons/canonize'
import { RULE_CODES } from '../src/lib/reasons/rules'

const showRemainder = process.argv.includes('--show-remainder')

try {
  // Pull texts from parsed acts rather than denials: reason text lives
  // in reason_texts, which isn't populated yet.
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
    console.log('No reason texts in the DB. Fetch and parse pages first.')
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
        // Partially covered ones matter too: the remainder goes to the LLM.
        remainders.push(analysis.remainder)
      }
    }

    const total = texts.length
    console.log(`texts: ${total}, unique after normalization: ${unique.size}`)
    console.log(
      `covered by at least one reason: ${covered} (${((100 * covered) / total).toFixed(0)}%) → ` +
        `to LLM: ${total - covered} (${((100 * (total - covered)) / total).toFixed(0)}%)`,
    )
    console.log(`average share of covered text: ${(ratioSum / total).toFixed(3)}`)

    console.log('\nby detection method:', Object.fromEntries(byMethod))

    console.log('\natomic reason frequencies:')
    for (const [slug, count] of [...bySlug.entries()].sort((a, b) => b[1] - a[1])) {
      const rule = RULE_CODES.find((r) => r.slug === slug)
      console.log(
        `  ${String(count).padStart(4)} (${String(Math.round((100 * count) / total)).padStart(3)}%)  ${slug.padEnd(22)} ${rule?.note ?? ''}`,
      )
    }

    console.log(
      '\nreasons per text:',
      Object.fromEntries([...perTextCounts.entries()].sort((a, b) => a[0] - b[0])),
    )

    if (showRemainder) {
      console.log(`\nremainders for LLM (${remainders.length}), first 12:`)
      for (const r of remainders.slice(0, 12)) console.log(`  • ${r.slice(0, 200)}`)
    }
  }
} catch (error) {
  console.error('Error:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
