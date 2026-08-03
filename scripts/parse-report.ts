/**
 * Runs the parser over already-fetched pages and prints the results.
 *
 *   npx tsx --env-file-if-exists=.env scripts/parse-report.ts
 *   npx tsx --env-file-if-exists=.env scripts/parse-report.ts --limit=5 --verbose
 *
 * Writes nothing to the DB (read-only). Needed to see the effect of
 * parser changes before they hit the data, and to find paragraphs the
 * parser failed to understand.
 */
import { desc, eq } from 'drizzle-orm'
import { closePool, db } from '../src/db/client'
import { sourcePageHtml, sourcePages } from '../src/db/schema'
import { splitActs } from '../src/lib/dou/acts'
import { extractApprovals } from '../src/lib/dou/approvals'
import { extractDenials } from '../src/lib/dou/denials'
import { extractBlocks } from '../src/lib/dou/page'

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

const limit = Number.parseInt(arg('limit') ?? '50', 10)
const verbose = process.argv.includes('--verbose')

try {
  const pages = await db
    .select({
      urlTitle: sourcePages.urlTitle,
      editionDate: sourcePages.editionDate,
      title: sourcePages.title,
      html: sourcePageHtml.html,
    })
    .from(sourcePages)
    .innerJoin(sourcePageHtml, eq(sourcePageHtml.pageId, sourcePages.id))
    .where(eq(sourcePages.fetchStatus, 'fetched'))
    .orderBy(desc(sourcePages.editionDate))
    .limit(limit)

  const totals = {
    pages: pages.length,
    acts: 0,
    byKind: {} as Record<string, number>,
    approvals: 0,
    denials: 0,
    upheld: 0,
    nonNaturalization: 0,
    withoutBirthDate: 0,
    withoutState: 0,
    withoutProcess: 0,
    withoutReasonText: 0,
    unparsed: 0,
  }

  for (const page of pages) {
    const blocks = extractBlocks(page.html)
    const acts = splitActs(blocks)
    totals.acts += acts.length

    // The header is printed before parsing: otherwise paragraph warnings
    // get attributed to the next page.
    console.log(`\n${page.editionDate} ${page.urlTitle}`)

    const perPage: string[] = []

    for (const act of acts) {
      totals.byKind[act.kind] = (totals.byKind[act.kind] ?? 0) + 1

      if (act.kind === 'approval') {
        const { people, unparsed } = extractApprovals(act.paragraphs)
        totals.approvals += people.length
        totals.unparsed += unparsed.length
        totals.withoutBirthDate += people.filter((p) => !p.birthDate).length
        totals.withoutState += people.filter((p) => !p.stateRaw).length
        totals.withoutProcess += people.filter((p) => !p.processNumberNorm).length
        perPage.push(`act#${act.ordinal} approval(${act.naturalizationType ?? '?'}): ${people.length} people`)
        for (const u of unparsed) console.log(`  [UNPARSED: ${u.reason}] ${u.text.slice(0, 180)}`)
        if (verbose) {
          for (const p of people.slice(0, 3)) {
            console.log(
              `    ${p.fullName} | ${p.countryRaw} | ${p.birthDate ?? '—'} | ${p.stateRaw ?? '—'} | conf ${p.confidence}`,
            )
          }
        }
      } else if (act.kind === 'denial_list') {
        const { denials, unparsed } = extractDenials(act.paragraphs)
        totals.denials += denials.length
        totals.unparsed += unparsed.length
        totals.upheld += denials.filter((d) => d.isUpheld).length
        totals.nonNaturalization += denials.filter((d) => d.subjectKind !== 'naturalization').length
        totals.withoutReasonText += denials.filter((d) => !d.reasonText).length
        perPage.push(`act#${act.ordinal} denial_list: ${denials.length} blocks`)
        for (const u of unparsed) console.log(`  [UNPARSED: ${u.reason}] ${u.text.slice(0, 180)}`)
        if (verbose) {
          for (const d of denials.slice(0, 3)) {
            console.log(
              `    ${d.fullName} | ${d.assuntoRaw} → ${d.decisionKind}${d.isUpheld ? '/upheld' : ''} | ${d.subjectKind} | reason ${d.reasonText ? `${d.reasonText.length} chars` : '—'}`,
            )
          }
        }
      } else {
        perPage.push(`act#${act.ordinal} ${act.kind}`)
      }
    }

    console.log(`  ${acts.length} act(s): ${perPage.join('; ')}`)
  }

  console.log('\n───── TOTALS ─────')
  console.log(`pages: ${totals.pages}, acts: ${totals.acts}`)
  console.log(`by act type: ${JSON.stringify(totals.byKind)}`)
  console.log(`approvals: ${totals.approvals} (without birth date ${totals.withoutBirthDate}, without state ${totals.withoutState}, without process ${totals.withoutProcess})`)
  console.log(`denials: ${totals.denials} (upheld ${totals.upheld}, not about naturalization ${totals.nonNaturalization}, without reason text ${totals.withoutReasonText})`)
  console.log(`UNPARSED paragraphs: ${totals.unparsed}`)
} catch (error) {
  console.error('Error:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
