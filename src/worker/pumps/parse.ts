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
 * Версия парсера. Увеличивать при изменении правил разбора: страницы
 * с меньшим значением будут переразобраны автоматически.
 */
export const PARSER_VERSION = 1

type Claim = {
  id: string
  urlTitle: string
  editionDate: string
  html: string
}

/**
 * Захват страниц под разбор.
 *
 * Захват ОБЯЗАН менять строку. Одного `for update skip locked` мало:
 * блокировка снимается с концом запроса, и два параллельных насоса берут
 * одни и те же страницы — наблюдалось на практике, один прогон записал
 * данные, второй упал на уникальном индексе. Поэтому статус переводится
 * в `running` с арендой по `parsed_at`: упавший процесс не держит
 * страницу дольше аренды.
 */
async function claimPages(limit: number, leaseMs: number): Promise<Claim[]> {
  const claimed = await db.execute<{ id: string }>(sql`
    with candidates as (
      select id
      from ${sourcePages}
      where fetch_status = 'fetched'
        and parser_version < ${PARSER_VERSION}
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

/** Справочники читаются один раз на прогон, а не на строку. */
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
 * Разбирает загруженные страницы: акты, людей, блоки решений.
 *
 * Переразбор не удаляет детей, а сопоставляет их по хешу абзаца и
 * `codigo`: иначе при росте PARSER_VERSION терялись бы идентификаторы
 * и ручные правки. Пропавшие записи помечаются retired_at, а не
 * удаляются физически.
 */
export const parsePages: Pump = async ({ log }) => {
  const { fetchBatch, claimLeaseMs } = pipelineConfig()
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

  for (const claim of claims) {
    const blocks = extractBlocks(claim.html)

    if (blocks.length === 0) {
      // Тело есть, а текстовых блоков нет — разметка изменилась.
      schemaMismatch += 1
      await db
        .update(sourcePages)
        .set({
          parseStatus: 'schema_mismatch',
          parseError: 'нет блоков identifica/dou-paragraph',
          parserVersion: PARSER_VERSION,
          parsedAt: new Date(),
        })
        .where(eq(sourcePages.id, claim.id))
      log(`${claim.urlTitle}: РАЗМЕТКА ИЗМЕНИЛАСЬ — нет текстовых блоков`)
      continue
    }

    const parsedActs = splitActs(blocks)
    let pageUnparsed = 0

    await db.transaction(async (tx) => {
      // Акты пересоздаются: их дети (люди, решения) висят на act_id
      // и восстанавливаются в этой же транзакции по своим ключам.
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
                // Возраст считается от даты выпуска, а не от now():
                // при переразборе значение должно остаться тем же.
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
              .values(values)
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
             * Текст причины дедуплицируется в reason_texts: одинаковые
             * тексты канонизируются и уходят в LLM один раз, а не по
             * разу на каждый отказ (замер: 267 отказов → 203 текста).
             * Здесь считается только дешёвый ключ, без правил, поэтому
             * рост RULES_VERSION не требует переразбора страниц.
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
                // rules_version при повторной встрече не сбрасывается:
                // иначе уже канонизированный текст переразбирался бы вечно.
                // occurrences здесь не трогаем — он пересчитывается ниже
                // из фактических связей.
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
              // Повторную публикацию выставляет отдельный насос
              // link-appeals: для этого нужна вся история, а не одна страница.
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
              .values(values)
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
             * occurrences — производная величина, а не счётчик приращений.
             * Инкремент здесь давал бы неверное число дважды: внутри
             * страницы один текст встречается у нескольких отказов, а при
             * переразборе прибавка легла бы поверх старой. Пересчёт из
             * фактических связей всегда верен и идемпотентен.
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

      // Записи, исчезнувшие после переразбора: не удаляем, а помечаем.
      // Молчаливая потеря человека — худший возможный отказ парсера.
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
        })
        .where(eq(sourcePages.id, claim.id))

      // Витрины за этот день пересчитает rollup.
      await tx
        .insert(dirtyDays)
        .values({ day: claim.editionDate, reason: 'parse' })
        .onConflictDoUpdate({
          target: dirtyDays.day,
          set: { reason: sql`'parse'`, markedAt: sql`now()` },
        })

      actsTotal += parsedActs.length
    })

    unparsedTotal += pageUnparsed
    pagesDone += 1
  }

  log(
    `страниц ${pagesDone}, актов ${actsTotal}, одобрений ${approvalsTotal}, ` +
      `решений ${denialsTotal}, не разобрано ${unparsedTotal}`,
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
    },
  }
}
