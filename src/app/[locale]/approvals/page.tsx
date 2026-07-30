import { notFound } from 'next/navigation'
import { Empty, SourceLink } from '@/components/feed/common'
import { FilterForm } from '@/components/feed/filter-form'
import { Pager } from '@/components/feed/pager'
import { getTranslator, isLocale, type Locale } from '@/i18n'
import { Flag } from '@/components/flag'
import { formatEditionDate, formatNumber } from '@/lib/format'
import {
  getApprovals,
  getCountryOptions,
  getStateOptions,
  parseCursor,
  type ApprovalItem,
} from '@/lib/queries/feeds'

export const dynamic = 'force-dynamic'

type Search = { country?: string; state?: string; q?: string; cursor?: string }

export default async function ApprovalsPage({
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
  const basePath = `/${locale}/approvals`

  const [countries, states, page] = await Promise.all([
    getCountryOptions(),
    getStateOptions(),
    getApprovals(
      { country: search.country, state: search.state, q: search.q },
      parseCursor(search.cursor),
    ),
  ])

  const name = (ru: string, en: string) => (locale === 'ru' ? ru : en)

  return (
    <div className="space-y-4">
      <FilterForm
        action={basePath}
        applyLabel={d.filters.apply}
        resetLabel={d.filters.reset}
        fields={[
          {
            kind: 'select',
            name: 'country',
            label: d.filters.country,
            value: search.country ?? '',
            // Без флага: в нативный `<option>` разметку вставить нельзя,
            // а нативный список на телефоне ценнее флажка в строке.
            options: countries.map((c) => ({
              value: c.iso2,
              label: `${name(c.nameRu, c.nameEn)} · ${c.approvals}`,
            })),
          },
          {
            kind: 'select',
            name: 'state',
            label: d.filters.state,
            value: search.state ?? '',
            options: states.map((s) => ({
              value: s.uf,
              label: `${name(s.nameRu, s.nameEn)} · ${s.approvals}`,
            })),
          },
          {
            kind: 'search',
            name: 'q',
            label: d.filters.nameSearch,
            value: search.q ?? '',
          },
        ]}
      />

      {page.items.length === 0 ? (
        <Empty title={d.feed.empty} hint={d.feed.emptyHint} />
      ) : (
        <>
          <Cards locale={locale} items={page.items} labels={d} />
          <Table locale={locale} items={page.items} labels={d} />
          <Pager basePath={basePath} params={search} next={page.next} label={d.feed.more} />
        </>
      )}
    </div>
  )
}

type Labels = ReturnType<typeof getTranslator>['d']

function Cards({
  locale,
  items,
  labels,
}: {
  locale: Locale
  items: ApprovalItem[]
  labels: Labels
}) {
  return (
    <ul className="space-y-2.5 sm:hidden">
      {items.map((item) => (
        <li key={item.id} className="rounded-2xl border border-hairline bg-surface p-3.5">
          <p className="text-sm font-medium text-ink">{item.fullName}</p>

          <p className="mt-1.5 text-xs text-ink-secondary">
            <Flag iso2={item.countryIso2} className="mr-1.5" />
            {locale === 'ru' ? item.countryNameRu : item.countryNameEn}
            {item.stateUf && (
              <>
                {' · '}
                {locale === 'ru' ? item.stateNameRu : item.stateNameEn}
              </>
            )}
          </p>

          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-muted">
            <span>{formatEditionDate(locale, item.editionDate)}</span>
            {item.age !== null && (
              <span>
                {labels.fields.age}: {formatNumber(locale, item.age)}
              </span>
            )}
          </p>

          <SourceLink url={item.sourceUrl} label={labels.common.openOriginal} />
        </li>
      ))}
    </ul>
  )
}

function Table({
  locale,
  items,
  labels,
}: {
  locale: Locale
  items: ApprovalItem[]
  labels: Labels
}) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-hairline bg-surface sm:block">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-hairline text-ink-muted">
            <th scope="col" className="px-4 py-2.5 font-medium">{labels.fields.name}</th>
            <th scope="col" className="px-4 py-2.5 font-medium">{labels.fields.country}</th>
            <th scope="col" className="px-4 py-2.5 font-medium">{labels.fields.state}</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">{labels.fields.age}</th>
            <th scope="col" className="px-4 py-2.5 font-medium">{labels.fields.publishedAt}</th>
            <th scope="col" className="px-4 py-2.5 font-medium">{labels.common.source}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-hairline last:border-0">
              <th scope="row" className="px-4 py-2.5 font-normal text-ink">{item.fullName}</th>
              <td className="px-4 py-2.5 text-ink-secondary">
                <Flag iso2={item.countryIso2} className="mr-1.5" />
                {locale === 'ru' ? item.countryNameRu : item.countryNameEn}
              </td>
              <td className="px-4 py-2.5 text-ink-secondary">
                {locale === 'ru' ? item.stateNameRu : item.stateNameEn}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">
                {item.age === null ? '—' : formatNumber(locale, item.age)}
              </td>
              <td className="px-4 py-2.5 tabular-nums text-ink-secondary">
                {formatEditionDate(locale, item.editionDate)}
              </td>
              <td className="px-4 py-2.5">
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-series-1 hover:underline"
                >
                  DOU ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

