import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import {
  acts,
  approvals,
  brStateAliases,
  countryAliases,
  denials,
  dirtyDays,
  reasonTexts,
  sourcePageHtml,
  sourcePages,
} from '../../db/schema'
import { reasonDedupKey } from '../../lib/reasons/normalize'
import { splitActs } from '../../lib/dou/acts'
import { extractApprovals } from '../../lib/dou/approvals'
import { extractDenials } from '../../lib/dou/denials'
import { extractBlocks } from '../../lib/dou/page'
import { pipelineConfig } from '../../lib/env'
import { ageOn, normalizeCountryName, normalizeKey, normalizeName, sha256Hex } from '../../lib/text'
import type { Pump } from './types'

/**
 * Parser version. Bump it when parsing rules change: pages with a lower
 * value will be re-parsed automatically.
 */
export const PARSER_VERSION = 1

type Claim = {
  id: string
  urlTitle: string
  editionDate: string
  html: string
  parseAttempts: number
}

/**
 * Claims pages for parsing.
 *
 * The claim MUST modify the row. `for update skip locked` alone isn't
 * enough: the lock is released once the query ends, and two parallel
 * pumps would pick up the same pages: observed in practice, one run
 * wrote the data, the other failed on a unique index. That's why the
 * status moves to `running` with a lease via `parsed_at`: a crashed
 * process doesn't hold onto a page past its lease.
 */
async function claimPages(limit: number, leaseMs: number): Promise<Claim[]> {
  const claimed = await db.execute<{ id: string }>(sql`
    with candidates as (
      select id
      from ${sourcePages}
      where fetch_status = 'fetched'
        and parser_version < ${PARSER_VERSION}
        -- A page that just failed parsing waits out its backoff: otherwise
        -- one poisoned page would come back in every batch and crowd out healthy ones.
        and (parse_next_attempt_at is null or parse_next_attempt_at < now())
        and (
          parse_status <> 'running'
          or parsed_at is null
          or parsed_at < now() - make_interval(secs => ${Math.round(leaseMs / 1000)})
        )
      order by edition_date desc
      limit ${limit}
      for update skip locked
    )
    update ${sourcePages} p
       set parse_status = 'running', parsed_at = now()
      from candidates c
     where p.id = c.id
    returning p.id
  `)

  if (claimed.rows.length === 0) return []

  return db
    .select({
      id: sourcePages.id,
      urlTitle: sourcePages.urlTitle,
      editionDate: sourcePages.editionDate,
      html: sourcePageHtml.html,
      parseAttempts: sourcePages.parseAttempts,
    })
    .from(sourcePages)
    .innerJoin(sourcePageHtml, eq(sourcePageHtml.pageId, sourcePages.id))
    .where(
      inArray(
        sourcePages.id,
        claimed.rows.map((r) => r.id),
      ),
    )
}

/**
 * Releases the claim after a parse failure and schedules a backoff.
 *
 * The backoff doubles with each attempt, same as fetching: the failure
 * cause might be transient (disk space, an unreachable lookup table), and
 * there's no point hammering the page every five minutes. After
 * `maxAttempts` the page moves to `failed` and is no longer picked up.
 * Otherwise it would forever occupy a slot in the batch.
 */
async function releaseParseClaim(
  claim: Claim,
  message: string,
  maxAttempts: number,
): Promise<void> {
  const attempts = claim.parseAttempts + 1
  const giveUp = attempts >= maxAttempts
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, attempts - 1))

  await db.execute(sql`
    update ${sourcePages}
       set parse_status = ${giveUp ? 'failed' : 'pending'},
           parse_error = ${message.slice(0, 1000)},
           parse_attempts = ${attempts},
           parse_next_attempt_at = ${
             giveUp ? null : sql`now() + make_interval(secs => ${delaySeconds})`
           }
     where id = ${claim.id}
  `)
}

/**
 * Keeps one row per key, preserving order.
 *
 * Needed before `insert ... on conflict`: Postgres rejects an entire
 * INSERT outright if it contains two rows with the same key: not just
 * the extra row, the whole statement fails.
 */
function dedupeBy<T>(rows: T[], key: (row: T) => string | number): T[] {
  const seen = new Set<string | number>()
  return rows.filter((row) => {
    const k = key(row)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Lookup tables are read once per run, not once per row. */
async function loadLookups(): Promise<{
  countries: Map<string, number>
  states: Map<string, number>
}> {
  const [countryRows, stateRows] = await Promise.all([
    db.select({ alias: countryAliases.aliasNorm, id: countryAliases.countryId }).from(countryAliases),
    db.select({ alias: brStateAliases.aliasNorm, id: brStateAliases.stateId }).from(brStateAliases),
  ])

  return {
    countries: new Map(countryRows.map((r) => [r.alias, r.id])),
    states: new Map(stateRows.map((r) => [r.alias, r.id])),
  }
}

/**
 * Parses fetched pages: acts, people, decision blocks.
 *
 * Re-parsing doesn't delete children, it matches them by paragraph hash
 * and `codigo`: otherwise bumping PARSER_VERSION would lose identifiers
 * and manual edits. Records that disappear are flagged with retired_at,
 * not physically deleted.
 */
export const parsePages: Pump = async ({ log }) => {
  const { fetchBatch, claimLeaseMs, maxAttempts } = pipelineConfig()
  const claims = await claimPages(fetchBatch, claimLeaseMs)
  if (claims.length === 0) return { itemsProcessed: 0, meta: { pages: 0 } }

  const lookups = await loadLookups()

  let pagesDone = 0
  let actsTotal = 0
  let approvalsTotal = 0
  let denialsTotal = 0
  let unparsedTotal = 0
  let unmappedCountries = 0
  let schemaMismatch = 0
  let failures = 0

  for (const claim of claims) {
    const blocks = extractBlocks(claim.html)

    if (blocks.length === 0) {
      // There's a body but no text blocks: markup changed.
      schemaMismatch += 1
      await db
        .update(sourcePages)
        .set({
          parseStatus: 'schema_mismatch',
          parseError: 'no identifica/dou-paragraph blocks',
          parserVersion: PARSER_VERSION,
          parsedAt: new Date(),
        })
        .where(eq(sourcePages.id, claim.id))
      log(`${claim.urlTitle}: MARKUP CHANGED (no text blocks)`)
      continue
    }

    const parsedActs = splitActs(blocks)
    let pageUnparsed = 0

    try {
      await db.transaction(async (tx) => {
        // Acts are recreated: their children (people, decisions) hang off
        // act_id and get reattached in the same transaction by their own keys.
        const actIds: string[] = []

        for (const act of parsedActs) {
          const [row] = await tx
            .insert(acts)
            .values({
              pageId: claim.id,
              editionDate: claim.editionDate,
              ordinal: act.ordinal,
              identificaRaw: act.identifica,
              actKind: act.kind,
              naturalizationType: act.naturalizationType,
              legalBasis: act.legalBasis,
              paragraphs: act.paragraphs,
              bodySha256: act.bodySha256,
            })
            .onConflictDoUpdate({
              target: [acts.pageId, acts.ordinal],
              set: {
                identificaRaw: sql`excluded.identifica_raw`,
                actKind: sql`excluded.act_kind`,
                naturalizationType: sql`excluded.naturalization_type`,
                legalBasis: sql`excluded.legal_basis`,
                paragraphs: sql`excluded.paragraphs`,
                bodySha256: sql`excluded.body_sha256`,
                editionDate: sql`excluded.edition_date`,
              },
            })
            .returning({ id: acts.id })

          if (!row) continue
          actIds.push(row.id)

          if (act.kind === 'approval') {
            const { people, unparsed } = extractApprovals(act.paragraphs)
            pageUnparsed += unparsed.length

            if (people.length > 0) {
              const values = people.map((person, index) => {
                const countryId = person.countryRaw
                  ? (lookups.countries.get(normalizeCountryName(person.countryRaw)) ?? null)
                  : null
                if (person.countryRaw && countryId === null) unmappedCountries += 1

                return {
                  actId: row.id,
                  pageId: claim.id,
                  editionDate: claim.editionDate,
                  ordinal: index,
                  fullName: person.fullName,
                  nameNorm: normalizeName(person.fullName),
                  documentId: person.documentId,
                  countryRaw: person.countryRaw,
                  countryId,
                  birthDate: person.birthDate,
                  birthDateRaw: person.birthDateRaw,
                  // Age is computed from the edition date, not from now():
                  // it must stay the same value on re-parse.
                  ageAtPublication: person.birthDate
                    ? ageOn(person.birthDate, claim.editionDate)
                    : null,
                  parentsRaw: person.parentsRaw,
                  stateRaw: person.stateRaw,
                  stateId: person.stateRaw
                    ? (lookups.states.get(normalizeKey(person.stateRaw)) ?? null)
                    : null,
                  processNumber: person.processNumber,
                  processNumberNorm: person.processNumberNorm,
                  paragraphText: person.paragraphText,
                  paragraphSha256: person.paragraphSha256,
                  parseConfidence: String(person.confidence),
                  parserVersion: PARSER_VERSION,
                  retiredAt: null,
                }
              })

              await tx
                .insert(approvals)
                // Dedup by conflict key is mandatory: if one
                // INSERT ... ON CONFLICT contains two rows with the same
                // key, Postgres rejects the whole statement ("cannot
                // affect row a second time"). The source actually does
                // this: in the 04/06/2026 edition, MANA ULYSSE and
                // SADRACK HERMILUS are repeated byte-for-byte within the
                // same act. The key here is the paragraph hash, so what
                // gets dropped is provably the same text, not a namesake.
                .values(dedupeBy(values, (v) => v.paragraphSha256))
                .onConflictDoUpdate({
                  target: [approvals.actId, approvals.paragraphSha256],
                  set: {
                    ordinal: sql`excluded.ordinal`,
                    fullName: sql`excluded.full_name`,
                    nameNorm: sql`excluded.name_norm`,
                    countryId: sql`excluded.country_id`,
                    stateId: sql`excluded.state_id`,
                    birthDate: sql`excluded.birth_date`,
                    ageAtPublication: sql`excluded.age_at_publication`,
                    parseConfidence: sql`excluded.parse_confidence`,
                    parserVersion: sql`excluded.parser_version`,
                    retiredAt: sql`null`,
                  },
                })

              approvalsTotal += values.length
            }
          } else if (act.kind === 'denial_list') {
            const { denials: parsed, unparsed } = extractDenials(act.paragraphs)
            pageUnparsed += unparsed.length

            if (parsed.length > 0) {
              /*
               * Reason text is deduplicated in reason_texts: identical
               * texts are canonized and sent to the LLM once, not once
               * per denial (measured: 267 denials → 203 texts). Only a
               * cheap key is computed here, no rules, so bumping
               * RULES_VERSION doesn't require re-parsing pages.
               */
              const textIdByHash = new Map<string, string>()
              for (const denial of parsed) {
                if (!denial.reasonText) continue
                const { textNorm } = reasonDedupKey(denial.reasonText)
                if (textNorm.length === 0) continue
                const hash = sha256Hex(textNorm)
                if (textIdByHash.has(hash)) continue

                const [textRow] = await tx
                  .insert(reasonTexts)
                  .values({
                    textRaw: denial.reasonText,
                    textNorm,
                    normSha256: hash,
                    occurrences: 1,
                  })
                  // rules_version isn't reset on a repeat occurrence:
                  // otherwise an already-canonized text would get re-parsed forever.
                  // occurrences is left untouched here: it's recomputed
                  // below from the actual links.
                  .onConflictDoUpdate({
                    target: reasonTexts.normSha256,
                    set: { textRaw: sql`${reasonTexts.textRaw}` },
                  })
                  .returning({ id: reasonTexts.id })

                if (textRow) textIdByHash.set(hash, textRow.id)
              }

              const values = parsed.map((denial) => ({
                actId: row.id,
                pageId: claim.id,
                editionDate: claim.editionDate,
                blockOrdinal: denial.blockOrdinal,
                codigo: denial.codigo,
                assuntoRaw: denial.assuntoRaw,
                decisionKind: denial.decisionKind,
                isUpheld: denial.isUpheld,
                subjectKind: denial.subjectKind,
                // Republication is set by a separate pump, link-appeals:
                // that needs the whole history, not just one page.
                isRepublication: false,
                countsAsNewDenial:
                  denial.decisionKind === 'denial' &&
                  !denial.isUpheld &&
                  denial.subjectKind === 'naturalization',
                processNumber: denial.processNumber,
                processNumberNorm: denial.processNumberNorm,
                fullName: denial.fullName,
                nameNorm: normalizeName(denial.fullName),
                reasonTextId: denial.reasonText
                  ? (textIdByHash.get(sha256Hex(reasonDedupKey(denial.reasonText).textNorm)) ?? null)
                  : null,
                parserVersion: PARSER_VERSION,
                retiredAt: null,
              }))

              await tx
                .insert(denials)
                // Same protection as for approvals: the conflict key here
                // is the block's ordinal position within the act.
                .values(dedupeBy(values, (v) => v.blockOrdinal))
                .onConflictDoUpdate({
                  target: [denials.actId, denials.blockOrdinal],
                  set: {
                    codigo: sql`excluded.codigo`,
                    assuntoRaw: sql`excluded.assunto_raw`,
                    decisionKind: sql`excluded.decision_kind`,
                    isUpheld: sql`excluded.is_upheld`,
                    subjectKind: sql`excluded.subject_kind`,
                    countsAsNewDenial: sql`excluded.counts_as_new_denial`,
                    processNumber: sql`excluded.process_number`,
                    processNumberNorm: sql`excluded.process_number_norm`,
                    fullName: sql`excluded.full_name`,
                    nameNorm: sql`excluded.name_norm`,
                    reasonTextId: sql`excluded.reason_text_id`,
                    parserVersion: sql`excluded.parser_version`,
                    retiredAt: sql`null`,
                  },
                })

              denialsTotal += values.length

              /*
               * occurrences is a derived value, not an increment counter.
               * Incrementing here would produce a wrong number twice: within
               * a page, one text occurs across multiple denials, and on
               * re-parse the increment would stack on top of the old value.
               * Recomputing from the actual links is always correct and idempotent.
               */
              const textIds = [...textIdByHash.values()]
              if (textIds.length > 0) {
                const counts = await tx
                  .select({ id: denials.reasonTextId, count: sql<number>`count(*)::int` })
                  .from(denials)
                  .where(and(inArray(denials.reasonTextId, textIds), isNull(denials.retiredAt)))
                  .groupBy(denials.reasonTextId)

                for (const entry of counts) {
                  if (!entry.id) continue
                  await tx
                    .update(reasonTexts)
                    .set({ occurrences: entry.count })
                    .where(eq(reasonTexts.id, entry.id))
                }
              }
            }
          }
        }

        // Records that disappeared after re-parsing: not deleted, just flagged.
        // Silently losing a person is the worst possible parser failure.
        await tx
          .update(approvals)
          .set({ retiredAt: new Date() })
          .where(and(eq(approvals.pageId, claim.id), sql`${approvals.parserVersion} < ${PARSER_VERSION}`))

        await tx
          .update(denials)
          .set({ retiredAt: new Date() })
          .where(and(eq(denials.pageId, claim.id), sql`${denials.parserVersion} < ${PARSER_VERSION}`))

        await tx
          .update(sourcePages)
          .set({
            parseStatus: pageUnparsed > 0 ? 'partial' : 'ok',
            parseError: null,
            parserVersion: PARSER_VERSION,
            parsedAt: new Date(),
            // Success resets the counter: the next failure on this page
            // should get a full set of attempts, not the leftover from last time.
            parseAttempts: 0,
            parseNextAttemptAt: null,
          })
          .where(eq(sourcePages.id, claim.id))

        // The dashboards for this day will be recomputed by rollup.
        await tx
          .insert(dirtyDays)
          .values({ day: claim.editionDate, reason: 'parse' })
          .onConflictDoUpdate({
            target: dirtyDays.day,
            set: { reason: sql`'parse'`, markedAt: sql`now()` },
          })

          actsTotal += parsedActs.length
      })
    } catch (error) {
      /*
       * One page must not stop parsing of the rest.
       * The transaction has already rolled itself back; here we only
       * release the claim and schedule a backoff. Otherwise the page
       * would come right back in the next batch and break everything again.
       *
       * The DB's actual reason lives in `cause`: drizzle puts only the
       * query text in message, and without `cause` the log is left with
       * a wall of parameters instead.
       */
      const err = error as Error & { cause?: { message?: string; detail?: string } }
      const reason = err.cause?.message ?? err.message
      const detail = err.cause?.detail ? ` (${err.cause.detail})` : ''

      failures += 1
      await releaseParseClaim(claim, `${reason}${detail}`, maxAttempts)
      log(`${claim.urlTitle}: PARSE FAILED: ${reason}${detail}`)
      continue
    }

    unparsedTotal += pageUnparsed
    pagesDone += 1
  }

  log(
    `pages ${pagesDone}, acts ${actsTotal}, approvals ${approvalsTotal}, ` +
      `decisions ${denialsTotal}, unparsed ${unparsedTotal}, failures ${failures}`,
  )

  return {
    itemsProcessed: pagesDone,
    meta: {
      pages: pagesDone,
      acts: actsTotal,
      approvals: approvalsTotal,
      denials: denialsTotal,
      unparsed: unparsedTotal,
      unmappedCountries,
      schemaMismatch,
      failures,
    },
  }
}
