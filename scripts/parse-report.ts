/**
 * Прогоняет парсер по уже загруженным страницам и печатает, что вышло.
 *
 *   npx tsx --env-file-if-exists=.env scripts/parse-report.ts
 *   npx tsx --env-file-if-exists=.env scripts/parse-report.ts --limit=5 --verbose
 *
 * Ничего не пишет в БД — только читает. Нужно, чтобы видеть последствия
 * правок парсера до того, как они попадут в данные, и чтобы находить
 * абзацы, которые парсер не понял.
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

    // Заголовок печатается до разбора: иначе предупреждения об абзацах
    // приписываются следующей странице.
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
        perPage.push(`акт#${act.ordinal} approval(${act.naturalizationType ?? '?'}): ${people.length} чел.`)
        for (const u of unparsed) console.log(`  [НЕ РАЗОБРАНО: ${u.reason}] ${u.text.slice(0, 180)}`)
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
        perPage.push(`акт#${act.ordinal} denial_list: ${denials.length} блоков`)
        for (const u of unparsed) console.log(`  [НЕ РАЗОБРАНО: ${u.reason}] ${u.text.slice(0, 180)}`)
        if (verbose) {
          for (const d of denials.slice(0, 3)) {
            console.log(
              `    ${d.fullName} | ${d.assuntoRaw} → ${d.decisionKind}${d.isUpheld ? '/upheld' : ''} | ${d.subjectKind} | причина ${d.reasonText ? `${d.reasonText.length} симв.` : '—'}`,
            )
          }
        }
      } else {
        perPage.push(`акт#${act.ordinal} ${act.kind}`)
      }
    }

    console.log(`  ${acts.length} акт(ов): ${perPage.join('; ')}`)
  }

  console.log('\n───── ИТОГО ─────')
  console.log(`страниц: ${totals.pages}, актов: ${totals.acts}`)
  console.log(`по типам актов: ${JSON.stringify(totals.byKind)}`)
  console.log(`одобрений: ${totals.approvals} (без даты рождения ${totals.withoutBirthDate}, без штата ${totals.withoutState}, без процесса ${totals.withoutProcess})`)
  console.log(`отказов: ${totals.denials} (подтверждений ${totals.upheld}, не о натурализации ${totals.nonNaturalization}, без текста причины ${totals.withoutReasonText})`)
  console.log(`НЕ РАЗОБРАНО абзацев: ${totals.unparsed}`)
} catch (error) {
  console.error('Ошибка:', error)
  process.exitCode = 1
} finally {
  await closePool()
}
