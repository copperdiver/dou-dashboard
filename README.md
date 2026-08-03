# DOU Dashboard

Brazil publishes every naturalization decision, approvals and denials alike, as a legal notice in its official gazette, the Diário Oficial da União (DOU). Each notice is a block of legal prose written by the Ministry of Justice, not structured data: a person's name, country of birth, and the reason a request was denied are all buried inside the text of a government bulletin.

This app watches the gazette for new naturalization notices, extracts the people and decisions out of the prose, and turns the result into a dashboard: daily approval and denial counts, denial reasons broken down by category, and a searchable feed of individual cases. A background worker does the fetching and parsing on a schedule; a Next.js frontend (English and Russian, light and dark) serves the dashboard.

## Stack

| Layer | Choice |
|---|---|
| UI and SSR | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Database | PostgreSQL 18, Drizzle ORM + drizzle-kit for migrations |
| Queues and scheduling | BullMQ + Redis 8, worker in a separate container |
| Running it | Docker Compose: `postgres`, `redis`, `migrate`, `web`, `worker` |

## Quick start: everything in Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Dashboard: http://localhost:3000

What happens: Postgres and Redis start, a one-shot `migrate` service enables the `pg_trgm`/`unaccent` extensions, applies migrations, loads reference data (250 countries with aliases, 27 states, categories and atomic denial reasons), and exits. Then `web` and `worker` start.

Reference data isn't demo data. Without it, country of birth and state of residence can't be matched, so it's part of the deployment rather than a separate step.

## Local development

Only the infrastructure stays in Docker; Next.js and the worker run on the host with hot reload:

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d
npm install
npm run db:migrate
npm run db:seed-reference

npm run dev          # terminal 1, http://localhost:3000
npm run worker:dev   # terminal 2, background jobs
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js in development mode |
| `npm run build` / `npm start` | production build and running it |
| `npm run worker` / `worker:dev` | the background job process (the second with watch) |
| `npm run backfill -- --days=365` | seed history for parsing |
| `npm run pump -- enumerate` | run a pump outside its schedule |
| `npm run db:generate` | generate a SQL migration from schema changes |
| `npm run db:migrate` | apply migrations |
| `npm run db:seed-reference` | load reference data (idempotent) |
| `npm run generate:countries` | regenerate the country list from ISO-3166 |
| `npm run db:studio` | Drizzle Studio |
| `npm run lint` / `npm run typecheck` | ESLint / type checking |

## Project layout

```
src/
  app/                 Next.js routes (App Router)
    page.tsx           dashboard
    api/health/        healthcheck for docker compose
  components/          UI: tiles, charts, tables
  db/
    schema.ts          Drizzle tables
    client.ts          lazy connection pool + drizzle instance
    migrate.ts         Postgres extensions + migration runner
    seed-reference.ts  reference data loader
    seeds/             reference data itself
  lib/
    text.ts            text/name/process-number normalization, age calculation
    stats.ts           statistics SQL queries
    format.ts          number, date, and duration formatting
  worker/
    index.ts           worker process: scheduling + job handling
    jobs.ts            job registry and their cron schedules
    queue.ts           BullMQ queue
    redis.ts           Redis connection
scripts/               developer utilities (reference data generation and checks)
drizzle/               generated SQL migrations
```

## Ingestion pipeline

Progress lives in Postgres tables; BullMQ is just the alarm clock. Every job is an idempotent pump: it claims a batch of work with `for update skip locked`, processes it, and exits. Restarting the worker, or running `docker compose down -v` on Redis, doesn't break a 250-day backfill.

| Pump | Queue | What it does |
|---|---|---|
| `discover` | jobs | queues the last week of days into `ingest_days` |
| `enumerate` | fetch | daily index to a `jsonArray` snapshot to a list of articles |
| `fetch` | fetch | downloads pages into `source_page_html` |
| `parse` | jobs | acts, people, decisions; flags the day in `dirty_days` |
| `canonize` | jobs | denial reasons via rules and the legal-reference decoder |
| `enrich` | llm | remaining reasons via the LLM |
| `rollup` | jobs | recomputes daily rollups for days from `dirty_days` |

Queues are split by resource class, not by pipeline step: BullMQ concurrency and rate limiting are configured per Worker. `dou-fetch` is the only queue that touches the network, at concurrency 1 and one request every 2 seconds. Pumps run with `attempts: 1`, since a "retry" is just the next cron tick, and per-item attempt tracking lives in the row itself (`attempts`, `next_attempt_at`).

Failures are handled by type instead of falling into one generic retry:

| Source response | Reaction |
|---|---|
| 403 / 429 | pause the whole `dou-fetch` queue without burning the attempt; three in a row pauses it for an hour |
| 404 / 410 | `fetch_status='gone'`, don't retry |
| 5xx, timeout | exponential backoff, `failed` after 5 attempts |
| 200 with no `script#params` | `failed` with an explicit "markup changed" reason; this signal must not be silenced by retries |
| empty daily index | `no_edition` (weekend, holiday), not `failed` |

Backfill and incremental polling run the same code. Only `origin` (for reporting) and `priority` differ: the pump reads `order by priority, edition_date desc`, so a fresh day never waits behind history still being processed.

One pump run is one row in `job_runs`, with details in `meta` (`{days, pages, noEdition, failures, schemaMismatch}`). `job_runs` doesn't turn into a log of individual items.

Claiming work has to change the row, not just lock it. A single `for update skip locked` isn't enough: the lock releases when the query ends, and two pumps can end up grabbing the same rows. So status flips to `running` with a time-based lease, and a crashed process doesn't hold work past its lease.

## Page parsing

Act type is determined by content, not by heading. Headings aren't reliable: `PORTARIA 6.375` without `Nº`, `Despachos` in inconsistent casing, an approval buried inside a despacho as `Assunto: Deferimento`.

What gets caught, and why it matters:

| Case | How it's handled |
|---|---|
| `CERTIFICO … passou a assinar` | a name change, not an approval; the line looks like a line about a person |
| `Requerente: … LTDA`, `Prazo: 2 Anos` | a work permit from the same department, not naturalization |
| `Manutenção de Indeferimento` | upholding a prior denial, not counted as a new denial |
| `Tornar sem efeito o Recurso de Manutenção` | overturns the decision; checked before `manutenção`, or it would be counted as upheld |
| `Arquivamento do pedido` | the case was closed, not denied on the merits |
| `Igualdade de Direitos`, `Reaquisição` | different procedures entirely: `subject_kind` isn't `naturalization` |

Block labels and person fields show up in different spellings, and every unhandled variant used to lose the whole record instead of just breaking one field: `Interessado:` / `Interessada:` / `Interessado(a):`, `Processo nº:` with "nº" before the colon, `natural doa` instead of `dos`, the document number spelled out as `RNM`, a missing comma before `nascido`. Field order within a block isn't fixed either; block boundaries are found by a label repeating.

An unparsed paragraph isn't discarded. It goes into the `unparsed` counter: silently losing a person is the worst failure mode a parser can have.

Diagnostics:

```bash
npx tsx --env-file-if-exists=.env scripts/parse-report.ts --verbose
npx tsx --env-file-if-exists=.env scripts/survey-blocks.ts
npm test
```

`parse-report.ts` runs the parser over pages that are already downloaded, without writing anything, so you can see the effect of a change before it hits the data. `survey-blocks.ts` shows which labels, `Assunto` values, and number formats actually occur, so rules are built from measurement rather than guesswork. Tests run against fixtures captured from real pages (`tests/fixtures/dou/`), refreshed with `scripts/save-fixtures.ts`.

When parsing rules change, bump `PARSER_VERSION` in `src/worker/pumps/parse.ts`: pages with a lower version get reparsed automatically. Reparsing doesn't delete records, it matches them by paragraph hash and `codigo`, and anything that disappears gets `retired_at`.

## Adding a background job

1. Describe it in `SCHEDULE` in `src/worker/jobs.ts`: name, queue, cron expression, description.
2. Add a handler in `handlers` under the same name.
3. Restart the worker. The schedule syncs automatically, and jobs removed from `SCHEDULE` get unscheduled.

```ts
// src/worker/jobs.ts
export const SCHEDULE = [
  { name: 'import-orders', queue: 'jobs', pattern: '*/10 * * * *', description: 'Import orders' },
]

export const handlers = {
  async 'import-orders'({ log }) {
    const orders = await claimOrders() // work comes from the DB, not the job payload
    log(`fetched ${orders.length}`)
    return { itemsProcessed: orders.length, meta: { orders: orders.length } }
  },
}
```

A pump has to be idempotent and pull its work from the database rather than the job payload. Only then is an extra or repeated run harmless, and progress survives losing Redis. If the source asks you to slow down, return `cooldownMs` and the worker pauses that queue without burning an attempt.

## Denial reasons

A reason is atomic, linked to a denial many-to-many. Reason text can't be matched by string equality: 267 denials produce 203 unique texts, and a single text usually contains several reasons.

Resolution runs from cheap to expensive, over unique texts rather than denials:

1. **Deduplication.** `reason_texts` holds one normalized text per unique reason; rules and the LLM each see a given text once.
2. **Rules** (`src/lib/reasons/rules.ts`, about a dozen regexes), matched per clause with evidence spans.
3. **Legal reference decoder** (`legal-refs.ts`). A bare article reference is context, not a reason: `art. 65` appears in 74% of texts, and if it counted as a reason on its own, the largest category on the chart would be meaningless. But an `inciso` number names a specific requirement: under `art. 65`, I is legal capacity, II length of residence, III Portuguese language, IV criminal record. Only the incisos whose meaning is confirmed by both the statute and observed phrasing are mapped.
4. **LLM**, only for whatever text remains uncovered, not the whole text.

Measured against 267 real texts: rules and the decoder cover 94%, and the LLM handles the remaining 6%.

### LLM provider

`LLM_PROVIDER=auto|claude|openai|noop`.

| Value | Behavior |
|---|---|
| `auto` (default) | claude if `ANTHROPIC_API_KEY` is set, otherwise openai if `OPENAI_API_KEY` is set, otherwise the stub |
| `claude` | Claude, model from `LLM_MODEL_CLAUDE` (defaults to `claude-opus-5`) |
| `openai` | OpenAI Responses API, model from `LLM_MODEL_OPENAI` (defaults to `gpt-5.2`) |
| `noop` | no LLM calls at all |

Keys live in `.env`, which is gitignored; the template is `.env.example`. A separate file like `.env.keys` wouldn't work, since neither docker compose nor Next.js reads it on its own.

Without keys, the pipeline runs on the stub instead of failing: fetching and parsing don't depend on the LLM. The stub keeps the original Portuguese text and doesn't invent translations, since a fake translation in the UI would look just as authoritative as a real one. Unresolved texts stay in `needs_review` and show up on the health screen.

An explicitly configured provider without a matching key is a configuration error, and the worker reports it right away. In `auto` mode, though, a stray `ANTHROPIC_API_KEY` sitting in the shell environment will win out over `OPENAI_API_KEY`, so set the provider explicitly if you need OpenAI specifically.

The prompt, response schema, and parsing logic are shared across providers (`src/lib/llm/prompt.ts`). Otherwise the wording would drift between them, and a quality difference would get blamed on the model instead of the prompt. The model itself is set by a separate variable per provider, since a shared one would eventually point at the wrong API and 404.

Rules live in code, not the database, because they need to be reviewed, tested against fixtures, and revertible. Bump `RULES_VERSION` when they change and texts get reparsed. Reparsing only removes automatic links; `method='manual'` links are untouched.

Diagnostics without writing to the database:

```bash
npx tsx --env-file-if-exists=.env scripts/reasons-report.ts --show-remainder
```

**The bar chart's metric is `count(distinct denial_id)` per category.** A denial can carry several reasons across different categories, so the sum across columns doesn't equal the number of denials (555 vs. 250 on current data). The label has to say so: "denials affected by category."

## Daily rollups

Rollups aren't about speed. At this data volume, any chart computes off the indexes in single-digit milliseconds. They exist for other reasons.

**One definition of "new denial."** It lives in `denials.counts_as_new_denial` rather than being spread across queries: a denial upheld on appeal, or republished, doesn't count again.

**Telling "no data" apart from "zero."** `daily_stats.coverage` is derived from `ingest_days`, not from the underlying facts:

| coverage | Meaning |
|---|---|
| `covered` | the day was fetched and parsed |
| `no_edition` | there was no edition that day (weekend, holiday) |
| `missing` | the day hasn't been fetched yet |

**The frontend has to draw a gap in the line for `missing`/`no_edition`, not a zero point,** or the chart lies and this whole design is wasted.

**Drilling down by category × day** without a three-table join on every point of the chart.

Recalculation is incremental: `parse` and `canonize` flag affected days in `dirty_days`, and `rollup` processes them. Recalculating a single day is a delete-and-insert in one transaction, so it's idempotent. A full rebuild just means seeding `dirty_days` with the range you want:

```sql
insert into dirty_days (day, reason)
select generate_series('2025-08-01'::date, current_date, '1 day')::date, 'rebuild'
on conflict (day) do nothing;
```

Age bucket boundaries are defined exactly once, in `AGE_BUCKET_SQL` (`src/worker/pumps/rollup.ts`) plus the `age_bucket` enum. There's deliberately no TypeScript function for this: the UI reads ready-made buckets from the rollup, and two definitions of the same boundaries would eventually drift apart.

The age histogram sums to less than the total number of approvals, by however many people have no recorded birth date (some don't, in the source). The UI needs to show that gap, or a total that doesn't add up reads as a bug.

## Data schema

One table, `job_runs`, is the run log: job name, status (`running` / `success` / `failed`), start and end time, duration, number of entities processed, error text, and a free-form `meta` in JSONB. The dashboard computes all of its statistics from it.

Changed `src/db/schema.ts`? Run `npm run db:generate`, then `npm run db:migrate`.

## Dashboard

- four daily KPI tiles, compared against the previous day
- a bar chart of daily runs, stacked success/failure, with a hover tooltip and an expandable table of exact values
- a per-job breakdown for the week, plus a log of recent runs

Series colors are blue and orange, a pair checked for colorblind distinguishability in both light and dark themes. Red/green doesn't work for that, so status colors appear only in badges, always paired with an icon and a label. The dark theme was designed separately rather than derived by inverting the light one; the header toggle reads "system / light / dark."

## Reference data

`countries` is populated from ISO-3166 (250 countries, names in Portuguese, English, and Russian). Matching country of birth doesn't rely on exact string matches. It goes through a normalized key via `country_aliases`, since DOU contains typos (`Guiná-Bissau`), outdated spelling (`Coréia do Sul`), and alternate forms (`Estado da Palestina`, `Belarus`). 66 observed spellings needed 9 aliases; `Congo` is flagged as ambiguous, since the source doesn't distinguish the Republic of Congo from the DR Congo.

When a new spelling shows up in the source, it lands in the unresolved-countries report. To check it and add an alias:

```bash
npx tsx --env-file-if-exists=.env scripts/resolve-reference.ts countries "New Spelling"
```

Then add it to `src/db/seeds/country-aliases.ts` and reload reference data.

There are exactly 8 denial-reason categories, including "Unclear." That's not a constraint from the domain, it's one from readability: a drill-down line chart can distinguish 6 to 8 lines at once. Each category has a fixed color slot, so a bar chart column and its drill-down line always match.

## Environment variables

All values are documented in `.env.example`. Inside compose, `DATABASE_URL` and `REDIS_URL` are substituted automatically with the `postgres` and `redis` hostnames; the values from `.env` apply when running locally.

| Variable | Purpose |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | database access |
| `POSTGRES_PORT` / `REDIS_PORT` / `WEB_PORT` | ports exposed to the host |
| `DATABASE_URL` / `REDIS_URL` | connection strings for running locally |
| `TZ` | timezone; affects how stats are grouped by day |
| `WORKER_CONCURRENCY` | how many jobs the worker runs in parallel (default 2) |
