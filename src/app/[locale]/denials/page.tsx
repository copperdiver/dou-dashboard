import { notFound } from 'next/navigation'
import { DecisionBadge, Empty, SourceLink } from '@/components/feed/common'
import { FilterForm } from '@/components/feed/filter-form'
import { Pager } from '@/components/feed/pager'
import { getTranslator, isLocale, type Locale } from '@/i18n'
import { formatEditionDate } from '@/lib/format'
import {
  getCategoryOptions,
  getDenials,
  parseCursor,
  type DenialItem,
  type DenialReasonItem,
} from '@/lib/queries/feeds'

export const dynamic = 'force-dynamic'

type Search = { category?: string; q?: string; upheld?: string; cursor?: string }

export default async function DenialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Search>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const search = await searchParams
  const { d } = getTranslator(locale)
  const basePath = `/${locale}/denials`
  const includeUpheld = search.upheld === '1'

  const [categories, page] = await Promise.all([
    getCategoryOptions(),
    getDenials(
      { category: search.category, q: search.q, includeUpheld },
      parseCursor(search.cursor),
    ),
  ])

  return (
    <div className="space-y-4">
      <FilterForm
        action={basePath}
        applyLabel={d.filters.apply}
        resetLabel={d.filters.reset}
        fields={[
          {
            kind: 'select',
            name: 'category',
            label: d.filters.category,
            value: search.category ?? '',
            options: categories.map((c) => ({
              value: c.code,
              label: locale === 'ru' ? c.nameRu : c.nameEn,
            })),
          },
          {
            kind: 'search',
            name: 'q',
            label: d.filters.nameSearch,
            value: search.q ?? '',
          },
          {
            kind: 'toggle',
            name: 'upheld',
            label: d.feed.showUpheld,
            checked: includeUpheld,
          },
        ]}
      />

      {page.items.length === 0 ? (
        <Empty title={d.feed.empty} hint={d.feed.emptyHint} />
      ) : (
        <>
          <ul className="space-y-2.5">
            {page.items.map((item) => (
              <DenialCard key={item.id} locale={locale} item={item} d={d} />
            ))}
          </ul>
          <Pager basePath={basePath} params={search} next={page.next} label={d.feed.more} />
        </>
      )}
    </div>
  )
}

type Labels = ReturnType<typeof getTranslator>['d']

/**
 * Denial card, the same at every width.
 *
 * There's no table here on purpose: a record has a variable number of
 * reasons with long text, and they don't fit into a cell at any screen size.
 */
function DenialCard({ locale, item, d }: { locale: Locale; item: DenialItem; d: Labels }) {
  return (
    <li className="rounded-2xl border border-hairline bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-ink">{item.fullName}</p>
        <p className="text-xs tabular-nums text-ink-muted">
          {formatEditionDate(locale, item.editionDate)}
        </p>
      </div>

      <Marks item={item} d={d} />

      {item.reasons.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {item.reasons.map((reason) => (
            <Reason key={`${item.id}-${reason.categoryId}-${reason.textPt.slice(0, 24)}`}
              locale={locale}
              reason={reason}
              d={d}
            />
          ))}
        </ul>
      )}

      <SourceLink url={item.sourceUrl} label={d.common.openOriginal} />
    </li>
  )
}

/** Marks about the nature of the decision: upheld, republication, termination. */
function Marks({ item, d }: { item: DenialItem; d: Labels }) {
  const marks: string[] = []

  if (item.isUpheld) {
    // An upheld decision with no link to the primary one is called out
    // separately: the primary decision was published before the loaded
    // period, and we can't pretend we've seen it.
    marks.push(item.hasPrimary ? d.decision.upheld : d.decision.upheldNoPrimary)
  }
  if (item.isRepublication) marks.push(d.decision.republication)
  if (item.decisionKind === 'archived') marks.push(d.decision.archived)
  if (item.decisionKind === 'void') marks.push(d.decision.void)

  if (marks.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {marks.map((mark) => (
        <DecisionBadge key={mark} label={mark} slot={8} />
      ))}
    </div>
  )
}

/**
 * Denial reason.
 *
 * A translation may not exist yet: the reason lands in the database with
 * the Portuguese original and gets translated later. We show the original
 * and honestly mark it as such, rather than hiding the record until translated.
 */
function Reason({
  locale,
  reason,
  d,
}: {
  locale: Locale
  reason: DenialReasonItem
  d: Labels
}) {
  const translated = locale === 'ru' ? reason.textRu : reason.textEn
  const text = translated ?? reason.textPt

  return (
    <li className="flex gap-2 text-xs">
      <span
        className="mt-1.5 size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--series-${reason.colorSlot})` }}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="text-ink-secondary">{text}</span>{' '}
        <span className="whitespace-nowrap text-ink-muted">
          · {locale === 'ru' ? reason.categoryNameRu : reason.categoryNameEn}
          {translated === null && ` · ${d.reasons.originalPt}`}
        </span>
      </span>
    </li>
  )
}
