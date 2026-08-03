import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/* ────────────────────────────────────────────────────────────────────────────
 * Background job log
 * ──────────────────────────────────────────────────────────────────────────── */

export const jobStatusEnum = pgEnum('job_status', ['running', 'success', 'failed'])

export type JobStatus = (typeof jobStatusEnum.enumValues)[number]

/**
 * One row per pump run, not per processed item: run details live in meta.
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobName: text('job_name').notNull(),
    queueJobId: text('queue_job_id'),
    attempt: integer('attempt').notNull().default(1),
    status: jobStatusEnum('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    itemsProcessed: integer('items_processed').notNull().default(0),
    error: text('error'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('job_runs_started_at_idx').on(t.startedAt.desc()),
    index('job_runs_job_name_started_at_idx').on(t.jobName, t.startedAt.desc()),
    index('job_runs_status_idx').on(t.status),
  ],
)

export type JobRun = typeof jobRuns.$inferSelect

/* ────────────────────────────────────────────────────────────────────────────
 * DOU data ingestion
 *
 * Edition date is a `date` everywhere, not derived from a timestamp: the
 * process timezone (Europe/Moscow in compose) shouldn't shift Brazilian days.
 * ──────────────────────────────────────────────────────────────────────────── */

export const ingestStatusEnum = pgEnum('ingest_status', [
  'pending',
  'running',
  'enumerated',
  'no_edition',
  'failed',
])

export const ingestOriginEnum = pgEnum('ingest_origin', ['backfill', 'incremental'])

/**
 * Polling state for a single day. This serves both as a queue for the
 * enumerate pump and as a coverage map: without it, a skipped day would
 * show up on the chart as "zero approvals", which is a lie.
 */
export const ingestDays = pgTable(
  'ingest_days',
  {
    editionDate: date('edition_date', { mode: 'string' }).notNull(),
    section: text('section').notNull().default('do1'),
    status: ingestStatusEnum('status').notNull().default('pending'),
    origin: ingestOriginEnum('origin').notNull().default('incremental'),
    /** Lower is earlier: fresh days don't wait for a year-long backfill to finish chewing through. */
    priority: smallint('priority').notNull().default(0),
    articlesFound: integer('articles_found'),
    relevantFound: integer('relevant_found'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.editionDate, t.section] }),
    index('ingest_days_claim_idx')
      .on(t.priority, t.editionDate.desc())
      .where(sql`${t.status} = 'pending'`),
    index('ingest_days_status_idx').on(t.status),
  ],
)

/**
 * Raw jsonArray of the daily index. Lets us broaden the relevance filter
 * and re-parse a whole year without hitting the network.
 */
export const ingestDaySnapshots = pgTable(
  'ingest_day_snapshots',
  {
    editionDate: date('edition_date', { mode: 'string' }).notNull(),
    section: text('section').notNull().default('do1'),
    jsonRaw: text('json_raw').notNull(),
    sha256: text('sha256').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.editionDate, t.section] })],
)

export const selectedByEnum = pgEnum('selected_by', ['hierarchy', 'keyword', 'both'])

export const fetchStatusEnum = pgEnum('fetch_status', ['pending', 'fetched', 'gone', 'failed'])

/** `running`: page has been claimed by the parse pump; the lease expires via parsed_at. */
export const parseStatusEnum = pgEnum('parse_status', [
  'pending',
  'running',
  'ok',
  'partial',
  'schema_mismatch',
  'failed',
])

/** A DOU article page. May contain anywhere from 1 to 13 acts. */
export const sourcePages = pgTable(
  'source_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    urlTitle: text('url_title').notNull(),
    url: text('url').notNull(),
    editionDate: date('edition_date', { mode: 'string' }).notNull(),
    section: text('section').notNull().default('do1'),
    editionNumber: text('edition_number'),
    pageNumber: text('page_number'),
    artType: text('art_type'),
    pubOrder: integer('pub_order'),
    hierarchyStr: text('hierarchy_str'),
    title: text('title'),
    /** How the article was selected: by agency hierarchy, by keyword, or both. */
    selectedBy: selectedByEnum('selected_by').notNull().default('hierarchy'),
    fetchStatus: fetchStatusEnum('fetch_status').notNull().default('pending'),
    httpStatus: integer('http_status'),
    fetchAttempts: integer('fetch_attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    fetchError: text('fetch_error'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    htmlSha256: text('html_sha256'),
    parserVersion: integer('parser_version').notNull().default(0),
    parseStatus: parseStatusEnum('parse_status').notNull().default('pending'),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    parseError: text('parse_error'),
    /*
     * Parse attempts get their own counter and their own backoff:
     * `next_attempt_at` next to them belongs to fetching, and sharing it
     * between two pumps would mean a parse failure delays a re-fetch.
     */
    parseAttempts: integer('parse_attempts').notNull().default(0),
    parseNextAttemptAt: timestamp('parse_next_attempt_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('source_pages_url_title_key').on(t.urlTitle),
    index('source_pages_edition_date_idx').on(t.editionDate.desc(), t.id.desc()),
    index('source_pages_fetch_claim_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.fetchStatus} in ('pending', 'failed')`),
    index('source_pages_parse_claim_idx')
      .on(t.parserVersion)
      .where(sql`${t.fetchStatus} = 'fetched'`),
  ],
)

/**
 * Page body lives in a separate table so the hot source_pages table stays
 * narrow. ~1000 pages a year at ~200KB each: tens of MB after TOAST compression.
 */
export const sourcePageHtml = pgTable('source_page_html', {
  pageId: uuid('page_id')
    .primaryKey()
    .references(() => sourcePages.id, { onDelete: 'cascade' }),
  html: text('html').notNull(),
  sha256: text('sha256').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})

export const actKindEnum = pgEnum('act_kind', [
  'approval',
  'denial_list',
  'name_change',
  'revocation',
  'loss_of_nationality',
  'other',
])

export const naturalizationTypeEnum = pgEnum('naturalization_type', [
  'ordinaria',
  'extraordinaria',
  'provisoria',
  'other',
])

/**
 * An act within a page. Its kind is determined BY CONTENT: headers are
 * unreliable (`PORTARIA #.#` without Nº, `Despachos` in mixed case,
 * `Deferimento` inside a despacho). art_type is stored only for reference.
 */
export const acts = pgTable(
  'acts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => sourcePages.id, { onDelete: 'cascade' }),
    editionDate: date('edition_date', { mode: 'string' }).notNull(),
    ordinal: integer('ordinal').notNull(),
    identificaRaw: text('identifica_raw'),
    actKind: actKindEnum('act_kind').notNull().default('other'),
    naturalizationType: naturalizationTypeEnum('naturalization_type'),
    /** Legal references as context: 'art.65', 'art.234', etc. */
    legalBasis: text('legal_basis').array(),
    paragraphs: jsonb('paragraphs').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    bodySha256: text('body_sha256'),
    parseNotes: text('parse_notes'),
  },
  (t) => [
    uniqueIndex('acts_page_ordinal_key').on(t.pageId, t.ordinal),
    index('acts_kind_edition_date_idx').on(t.actKind, t.editionDate.desc()),
  ],
)

/* ────────────────────────────────────────────────────────────────────────────
 * Reference data
 * ──────────────────────────────────────────────────────────────────────────── */

export const countries = pgTable(
  'countries',
  {
    id: smallint('id').primaryKey().generatedByDefaultAsIdentity(),
    iso2: text('iso2').notNull(),
    iso3: text('iso3'),
    namePt: text('name_pt').notNull(),
    nameEn: text('name_en').notNull(),
    nameRu: text('name_ru').notNull(),
  },
  (t) => [uniqueIndex('countries_iso2_key').on(t.iso2)],
)

/**
 * Country spellings that show up in DOU and don't match the ISO name:
 * source typos (`Guiná-Bissau`), outdated spelling (`Coréia do Sul`),
 * alternate forms (`Estado da Palestina`, `Belarus`).
 */
export const countryAliases = pgTable(
  'country_aliases',
  {
    aliasNorm: text('alias_norm').primaryKey(),
    countryId: smallint('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    /** true: the match is ambiguous and needs manual review. */
    isAmbiguous: boolean('is_ambiguous').notNull().default(false),
    note: text('note'),
  },
  (t) => [index('country_aliases_country_idx').on(t.countryId)],
)

export const brStates = pgTable(
  'br_states',
  {
    id: smallint('id').primaryKey().generatedByDefaultAsIdentity(),
    uf: text('uf').notNull(),
    namePt: text('name_pt').notNull(),
    nameEn: text('name_en').notNull(),
    nameRu: text('name_ru').notNull(),
    region: text('region').notNull(),
  },
  (t) => [uniqueIndex('br_states_uf_key').on(t.uf)],
)

export const brStateAliases = pgTable(
  'br_state_aliases',
  {
    aliasNorm: text('alias_norm').primaryKey(),
    stateId: smallint('state_id')
      .notNull()
      .references(() => brStates.id, { onDelete: 'cascade' }),
  },
  (t) => [index('br_state_aliases_state_idx').on(t.stateId)],
)

/* ────────────────────────────────────────────────────────────────────────────
 * Facts: approvals and denials, kept separate
 *
 * A polymorphic table would give us a swamp of nullable columns and
 * composite indexes, half of them useless: the fields, feeds, and stats
 * differ almost entirely.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * name_norm is a materialized column, not an expression index:
 * unaccent() is declared STABLE, so Postgres won't let us index
 * unaccent(name). Normalization happens in the app on write.
 */
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actId: uuid('act_id')
      .notNull()
      .references(() => acts.id, { onDelete: 'cascade' }),
    /** Denormalized: every feed query filters and sorts by date. */
    pageId: uuid('page_id')
      .notNull()
      .references(() => sourcePages.id, { onDelete: 'cascade' }),
    editionDate: date('edition_date', { mode: 'string' }).notNull(),
    ordinal: integer('ordinal').notNull(),
    fullName: text('full_name').notNull(),
    nameNorm: text('name_norm').notNull(),
    foreignId: text('foreign_id'),
    countryRaw: text('country_raw'),
    countryId: smallint('country_id').references(() => countries.id),
    birthDate: date('birth_date', { mode: 'string' }),
    birthDateRaw: text('birth_date_raw'),
    ageAtPublication: smallint('age_at_publication'),
    parentsRaw: text('parents_raw'),
    stateRaw: text('state_raw'),
    stateId: smallint('state_id').references(() => brStates.id),
    processNumber: text('process_number'),
    processNumberNorm: text('process_number_norm'),
    paragraphText: text('paragraph_text').notNull(),
    paragraphSha256: text('paragraph_sha256').notNull(),
    /** 1.0: all fields extracted; lower means some are missing from the source. */
    parseConfidence: numeric('parse_confidence', { precision: 3, scale: 2 }),
    parserVersion: integer('parser_version').notNull().default(1),
    /**
     * Republication: the same portaria for the same process was already
     * published earlier. Observed in practice: DOU publishes the same
     * document twice, under different identifiers and on different edition dates.
     */
    isRepublication: boolean('is_republication').notNull().default(false),
    /**
     * Counts as a new approval. Mirrors `counts_as_new_denial`: without
     * it, republications would double-count. Denials already had this
     * protection, approvals didn't.
     */
    countsAsNewApproval: boolean('counts_as_new_approval').notNull().default(true),
    /** Soft delete: on re-parse, the record doesn't just vanish without a trace. */
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('approvals_act_paragraph_key').on(t.actId, t.paragraphSha256),
    // Main feed: only new approvals, same as with denials.
    index('approvals_feed_idx')
      .on(t.editionDate.desc(), t.id.desc())
      .where(sql`${t.countsAsNewApproval} and ${t.retiredAt} is null`),
    // Separate index for output without filtering out repeats.
    index('approvals_all_feed_idx').on(t.editionDate.desc(), t.id.desc()),
    index('approvals_process_idx').on(t.processNumberNorm, t.editionDate),
    index('approvals_country_idx').on(t.countryId, t.editionDate.desc(), t.id.desc()),
    index('approvals_state_idx').on(t.stateId, t.editionDate.desc(), t.id.desc()),
    index('approvals_page_idx').on(t.pageId),
    index('approvals_name_trgm_idx').using('gin', sql`${t.nameNorm} gin_trgm_ops`),
  ],
)

/**
 * `archived` (`Arquivamento do pedido`): the process was closed, not
 * denied on the merits. A separate kind is needed so these decisions
 * don't end up in the denial count.
 */
export const decisionKindEnum = pgEnum('decision_kind', [
  'denial',
  'approval',
  'void',
  'archived',
  'other',
])

export const subjectKindEnum = pgEnum('subject_kind', [
  'naturalization',
  'expulsion',
  'nationality_loss',
  'other',
])

export const appealLinkMethodEnum = pgEnum('appeal_link_method', ['process', 'name', 'none'])

/**
 * A denial record. Double-counting is avoided with two materialized
 * flags, instead of conditions smeared across queries:
 *
 *  - is_upheld: `Manutenção de Indeferimento`, i.e. confirming a prior
 *    decision on appeal, not a new denial. The share is highly uneven
 *    (3.8% over 20 consecutive days vs. 47% in a sample spread across
 *    8 months): decisions get published in batches.
 *  - is_republication: the same process with the same decision type
 *    was already published on an earlier day (observed 1 in 834).
 */
export const denials = pgTable(
  'denials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actId: uuid('act_id')
      .notNull()
      .references(() => acts.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => sourcePages.id, { onDelete: 'cascade' }),
    editionDate: date('edition_date', { mode: 'string' }).notNull(),
    blockOrdinal: integer('block_ordinal').notNull(),
    /** `Código: 867230`, the best natural key for the block. */
    codigo: text('codigo'),
    assuntoRaw: text('assunto_raw'),
    decisionKind: decisionKindEnum('decision_kind').notNull().default('denial'),
    isUpheld: boolean('is_upheld').notNull().default(false),
    subjectKind: subjectKindEnum('subject_kind').notNull().default('naturalization'),
    isRepublication: boolean('is_republication').notNull().default(false),
    countsAsNewDenial: boolean('counts_as_new_denial').notNull().default(true),
    processNumber: text('process_number'),
    processNumberNorm: text('process_number_norm'),
    fullName: text('full_name').notNull(),
    nameNorm: text('name_norm').notNull(),
    reasonTextId: uuid('reason_text_id').references(() => reasonTexts.id),
    appealOfId: uuid('appeal_of_id').references((): AnyPgColumn => denials.id, {
      onDelete: 'set null',
    }),
    appealLinkMethod: appealLinkMethodEnum('appeal_link_method').notNull().default('none'),
    parserVersion: integer('parser_version').notNull().default(1),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('denials_act_block_key').on(t.actId, t.blockOrdinal),
    /*
     * `Código` is NOT unique even within a single act: confirmed by the
     * data. In the edition from 2026-03-20, code 727.407 appears on two
     * different decisions: one about a female applicant and a language
     * requirement (art. 65 III), another about a male applicant, criminal
     * record, and language (art. 234 III and V). This shows up on 10 out
     * of 886 pages.
     *
     * There used to be a unique index here, and it halted parsing entirely.
     * The real record key is `(act_id, block_ordinal)`, which is what the
     * upsert uses; the index on the code is only for lookups.
     */
    index('denials_act_codigo_idx').on(t.actId, t.codigo).where(sql`${t.codigo} is not null`),
    index('denials_feed_idx')
      .on(t.editionDate.desc(), t.id.desc())
      .where(sql`${t.countsAsNewDenial} and ${t.retiredAt} is null`),
    index('denials_all_feed_idx').on(t.editionDate.desc(), t.id.desc()),
    index('denials_process_idx').on(t.processNumberNorm, t.editionDate),
    index('denials_page_idx').on(t.pageId),
    index('denials_reason_text_idx').on(t.reasonTextId),
    index('denials_name_trgm_idx').using('gin', sql`${t.nameNorm} gin_trgm_ops`),
  ],
)

/* ────────────────────────────────────────────────────────────────────────────
 * Denial reason canonicalization
 *
 * Two levels: unique text (reason_texts) and an atomic canonical reason
 * (reasons). Deduplicating texts gives rules and the LLM 282 unique texts
 * to work with instead of 659 denials.
 * ──────────────────────────────────────────────────────────────────────────── */

export const reviewStateEnum = pgEnum('review_state', [
  'auto',
  'needs_review',
  'confirmed',
  'corrected',
])

export const reasonTexts = pgTable(
  'reason_texts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    textRaw: text('text_raw').notNull(),
    textNorm: text('text_norm').notNull(),
    normSha256: text('norm_sha256').notNull(),
    occurrences: integer('occurrences').notNull().default(0),
    /** Legal references are context, not the reason itself: 'art.65:III', 'art.234:II'. */
    legalRefs: text('legal_refs').array(),
    /** Share of text characters covered by rule spans (a quality metric). */
    coveredCharRatio: numeric('covered_char_ratio', { precision: 4, scale: 3 }),
    rulesVersion: integer('rules_version').notNull().default(0),
    reviewState: reviewStateEnum('review_state').notNull().default('auto'),
    classifiedAt: timestamp('classified_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('reason_texts_norm_key').on(t.normSha256),
    index('reason_texts_claim_idx')
      .on(t.rulesVersion)
      .where(sql`${t.reviewState} in ('auto', 'needs_review')`),
    index('reason_texts_norm_trgm_idx').using('gin', sql`${t.textNorm} gin_trgm_ops`),
  ],
)

/**
 * A closed list of categories. The size is limited not by the domain,
 * but by chart readability: a drill-down line chart can distinguish 6-8 lines.
 */
export const reasonCategories = pgTable(
  'reason_categories',
  {
    id: smallint('id').primaryKey().generatedByDefaultAsIdentity(),
    code: text('code').notNull(),
    nameRu: text('name_ru').notNull(),
    nameEn: text('name_en').notNull(),
    /** Series palette slot (1..8), so the bar chart and drill-down lines match up. */
    colorSlot: smallint('color_slot').notNull(),
    sortOrder: smallint('sort_order').notNull(),
  },
  (t) => [uniqueIndex('reason_categories_code_key').on(t.code)],
)

export const reasonStatusEnum = pgEnum('reason_status', ['draft', 'active', 'merged'])

export const reasonSourceEnum = pgEnum('reason_source', [
  'rule',
  'legal_ref',
  'similarity',
  'llm',
  'manual',
])

export const reasons = pgTable(
  'reasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    normalizedKey: text('normalized_key').notNull(),
    textPt: text('text_pt').notNull(),
    textEn: text('text_en'),
    textRu: text('text_ru'),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => reasonCategories.id),
    status: reasonStatusEnum('status').notNull().default('active'),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => reasons.id, {
      onDelete: 'set null',
    }),
    source: reasonSourceEnum('source').notNull().default('rule'),
    llmModel: text('llm_model'),
    promptVersion: text('prompt_version'),
    /** Manual edits aren't overwritten by reclassification. */
    isManuallyEdited: boolean('is_manually_edited').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reasons_slug_key').on(t.slug),
    uniqueIndex('reasons_normalized_key').on(t.normalizedKey),
    index('reasons_category_idx').on(t.categoryId),
  ],
)

/** Links a text to atomic reasons, with evidence spans. */
export const reasonTextReasons = pgTable(
  'reason_text_reasons',
  {
    reasonTextId: uuid('reason_text_id')
      .notNull()
      .references(() => reasonTexts.id, { onDelete: 'cascade' }),
    reasonId: uuid('reason_id')
      .notNull()
      .references(() => reasons.id, { onDelete: 'cascade' }),
    method: reasonSourceEnum('method').notNull(),
    ruleCode: text('rule_code'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    spanStart: integer('span_start'),
    spanEnd: integer('span_end'),
    rulesVersion: integer('rules_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.reasonTextId, t.reasonId] }),
    index('reason_text_reasons_reason_idx').on(t.reasonId),
  ],
)

/**
 * A flat link from denial to reasons: derived from reason_text_reasons,
 * but with category_id and edition_date carried through. Otherwise the
 * "category x day" drill-down would need a join across three tables.
 */
export const denialReasons = pgTable(
  'denial_reasons',
  {
    denialId: uuid('denial_id')
      .notNull()
      .references(() => denials.id, { onDelete: 'cascade' }),
    reasonId: uuid('reason_id')
      .notNull()
      .references(() => reasons.id, { onDelete: 'cascade' }),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => reasonCategories.id),
    editionDate: date('edition_date', { mode: 'string' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.denialId, t.reasonId] }),
    index('denial_reasons_category_idx').on(t.categoryId, t.editionDate.desc(), t.denialId),
    index('denial_reasons_reason_idx').on(t.reasonId, t.editionDate),
  ],
)

/** LLM response cache: re-parsing and re-runs come for free. */
export const llmCache = pgTable(
  'llm_cache',
  {
    promptVersion: text('prompt_version').notNull(),
    inputSha256: text('input_sha256').notNull(),
    response: jsonb('response').$type<Record<string, unknown>>().notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.promptVersion, t.inputSha256] })],
)

/* ────────────────────────────────────────────────────────────────────────────
 * Rollup tables
 *
 * These exist not for speed (at this volume any chart computes in 5-20ms),
 * but for consistent definitions, telling "no data" apart from "zero",
 * and for the category x day drill-down.
 * ──────────────────────────────────────────────────────────────────────────── */

export const coverageEnum = pgEnum('day_coverage', ['covered', 'missing', 'no_edition'])

/**
 * Age buckets. The values here and the boundaries in AGE_BUCKET_SQL
 * (src/worker/pumps/rollup.ts) are the single definition: change them
 * together, or inserting into the rollup table will fail on the enum cast.
 */
export const ageBucketEnum = pgEnum('age_bucket', [
  '0-17',
  '18-24',
  '25-34',
  '35-44',
  '45-54',
  '55-64',
  '65+',
])

export const dailyStats = pgTable('daily_stats', {
  day: date('day', { mode: 'string' }).primaryKey(),
  approvals: integer('approvals').notNull().default(0),
  denialsNew: integer('denials_new').notNull().default(0),
  denialsUpheld: integer('denials_upheld').notNull().default(0),
  otherDecisions: integer('other_decisions').notNull().default(0),
  pages: integer('pages').notNull().default(0),
  acts: integer('acts').notNull().default(0),
  /** From ingest_days, not from the facts: a day without an edition isn't "zero approvals". */
  coverage: coverageEnum('coverage').notNull().default('covered'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
})

export const dailyCountryStats = pgTable(
  'daily_country_stats',
  {
    day: date('day', { mode: 'string' }).notNull(),
    countryId: smallint('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'cascade' }),
    approvals: integer('approvals').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.countryId] }),
    index('daily_country_stats_country_idx').on(t.countryId, t.day),
  ],
)

export const dailyStateStats = pgTable(
  'daily_state_stats',
  {
    day: date('day', { mode: 'string' }).notNull(),
    stateId: smallint('state_id')
      .notNull()
      .references(() => brStates.id, { onDelete: 'cascade' }),
    approvals: integer('approvals').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.stateId] }),
    index('daily_state_stats_state_idx').on(t.stateId, t.day),
  ],
)

/**
 * A denial can have up to 6 reasons across different categories, so the
 * sum across columns is NOT equal to the number of denials: the metric
 * is count(distinct denial_id).
 */
export const dailyReasonCategoryStats = pgTable(
  'daily_reason_category_stats',
  {
    day: date('day', { mode: 'string' }).notNull(),
    categoryId: smallint('category_id')
      .notNull()
      .references(() => reasonCategories.id, { onDelete: 'cascade' }),
    denials: integer('denials').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.categoryId] }),
    index('daily_reason_category_stats_cat_idx').on(t.categoryId, t.day),
  ],
)

export const dailyAgeBucketStats = pgTable(
  'daily_age_bucket_stats',
  {
    day: date('day', { mode: 'string' }).notNull(),
    bucket: ageBucketEnum('bucket').notNull(),
    approvals: integer('approvals').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.bucket] })],
)

/**
 * Per-page rollup for the processed-articles feed. Materialized because
 * the feed sorts and filters by these counters, and sorting by an
 * aggregate through a join breaks keyset pagination. The recompute unit
 * is the page, so dirty_days isn't needed here.
 */
export const sourcePageStats = pgTable(
  'source_page_stats',
  {
    pageId: uuid('page_id')
      .primaryKey()
      .references(() => sourcePages.id, { onDelete: 'cascade' }),
    editionDate: date('edition_date', { mode: 'string' }).notNull(),
    actsTotal: integer('acts_total').notNull().default(0),
    actsByKind: jsonb('acts_by_kind').$type<Partial<Record<string, number>>>(),
    approvals: integer('approvals').notNull().default(0),
    denialsNew: integer('denials_new').notNull().default(0),
    denialsUpheld: integer('denials_upheld').notNull().default(0),
    otherDecisions: integer('other_decisions').notNull().default(0),
    peopleTotal: integer('people_total').notNull().default(0),
    countriesDistinct: integer('countries_distinct').notNull().default(0),
    statesDistinct: integer('states_distinct').notNull().default(0),
    reasonsDistinct: integer('reasons_distinct').notNull().default(0),
    reasonCategoriesDistinct: integer('reason_categories_distinct').notNull().default(0),
    topCountryId: smallint('top_country_id').references(() => countries.id),
    topReasonCategoryId: smallint('top_reason_category_id').references(() => reasonCategories.id),
    ageAvg: numeric('age_avg', { precision: 5, scale: 2 }),
    peopleWithoutBirthDate: integer('people_without_birth_date').notNull().default(0),
    /* Parse quality */
    unparsedParagraphs: integer('unparsed_paragraphs').notNull().default(0),
    /** A non-empty country_raw without a country_id: otherwise unrecognized
     *  countries would silently drop out of countries_distinct. */
    peopleWithoutCountry: integer('people_without_country').notNull().default(0),
    reasonTextsUncovered: integer('reason_texts_uncovered').notNull().default(0),
    avgCoveredCharRatio: numeric('avg_covered_char_ratio', { precision: 4, scale: 3 }),
    parserVersion: integer('parser_version').notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('source_page_stats_feed_idx').on(t.editionDate.desc(), t.pageId.desc()),
    index('source_page_stats_people_idx').on(t.peopleTotal.desc(), t.pageId.desc()),
    index('source_page_stats_uncovered_idx')
      .on(t.editionDate.desc())
      .where(sql`${t.reasonTextsUncovered} > 0`),
    index('source_page_stats_unparsed_idx')
      .on(t.editionDate.desc())
      .where(sql`${t.unparsedParagraphs} > 0`),
  ],
)

/** Days that need their rollups recomputed. */
export const dirtyDays = pgTable('dirty_days', {
  day: date('day', { mode: 'string' }).primaryKey(),
  reason: text('reason').notNull(),
  markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ────────────────────────────────────────────────────────────────────────────
 * Relations for Drizzle's relational queries
 * ──────────────────────────────────────────────────────────────────────────── */

export const sourcePagesRelations = relations(sourcePages, ({ many, one }) => ({
  acts: many(acts),
  html: one(sourcePageHtml, { fields: [sourcePages.id], references: [sourcePageHtml.pageId] }),
  stats: one(sourcePageStats, { fields: [sourcePages.id], references: [sourcePageStats.pageId] }),
}))

export const actsRelations = relations(acts, ({ one, many }) => ({
  page: one(sourcePages, { fields: [acts.pageId], references: [sourcePages.id] }),
  approvals: many(approvals),
  denials: many(denials),
}))

export const approvalsRelations = relations(approvals, ({ one }) => ({
  act: one(acts, { fields: [approvals.actId], references: [acts.id] }),
  country: one(countries, { fields: [approvals.countryId], references: [countries.id] }),
  state: one(brStates, { fields: [approvals.stateId], references: [brStates.id] }),
}))

export const denialsRelations = relations(denials, ({ one, many }) => ({
  act: one(acts, { fields: [denials.actId], references: [acts.id] }),
  reasonText: one(reasonTexts, { fields: [denials.reasonTextId], references: [reasonTexts.id] }),
  reasons: many(denialReasons),
}))

export const denialReasonsRelations = relations(denialReasons, ({ one }) => ({
  denial: one(denials, { fields: [denialReasons.denialId], references: [denials.id] }),
  reason: one(reasons, { fields: [denialReasons.reasonId], references: [reasons.id] }),
  category: one(reasonCategories, {
    fields: [denialReasons.categoryId],
    references: [reasonCategories.id],
  }),
}))

export const reasonsRelations = relations(reasons, ({ one, many }) => ({
  category: one(reasonCategories, {
    fields: [reasons.categoryId],
    references: [reasonCategories.id],
  }),
  texts: many(reasonTextReasons),
}))

/* ────────────────────────────────────────────────────────────────────────────
 * Inferred types
 * ──────────────────────────────────────────────────────────────────────────── */

export type IngestDay = typeof ingestDays.$inferSelect
export type SourcePage = typeof sourcePages.$inferSelect
export type NewSourcePage = typeof sourcePages.$inferInsert
export type Act = typeof acts.$inferSelect
export type NewAct = typeof acts.$inferInsert
export type Approval = typeof approvals.$inferSelect
export type NewApproval = typeof approvals.$inferInsert
export type Denial = typeof denials.$inferSelect
export type NewDenial = typeof denials.$inferInsert
export type ReasonText = typeof reasonTexts.$inferSelect
export type Reason = typeof reasons.$inferSelect
export type ReasonCategory = typeof reasonCategories.$inferSelect
export type Country = typeof countries.$inferSelect
export type BrState = typeof brStates.$inferSelect
export type SourcePageStat = typeof sourcePageStats.$inferSelect
export type ActKind = (typeof actKindEnum.enumValues)[number]
export type AgeBucket = (typeof ageBucketEnum.enumValues)[number]
