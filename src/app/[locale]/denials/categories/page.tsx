import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MultiLineChart } from '@/components/charts/multi-line-chart'
import { DateRange } from '@/components/date-range'
import { getTranslator, isLocale, type Locale } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { getCategorySeries, type CategorySeries } from '@/lib/queries/categories'
import { getDataBounds } from '@/lib/queries/overview'
import { resolveRange, today } from '@/lib/range'

export const dynamic = 'force-dynamic'

/**
 * Сколько категорий показывать, когда выбор не сделан.
 *
 * Восемь линий на одном поле не читаются даже на десктопе, поэтому
 * по умолчанию включены четыре крупнейшие. Остальные не спрятаны —
 * они перечислены рядом и включаются одним нажатием.
 */
const DEFAULT_VISIBLE = 4

type Search = { range?: string; from?: string; to?: string; category?: string; cats?: string }

export default async function CategoriesPage({
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
  const basePath = `/${locale}/denials/categories`

  const bounds = (await getDataBounds()) ?? { min: today(), max: today() }
  const range = resolveRange(search, bounds)
  const { days, series } = await getCategorySeries(range.from, range.to)

  const selected = resolveSelection(search, series)
  const visible = series.filter((s) => selected.has(s.code))

  return (
    <div className="space-y-4">
      <DateRange
        basePath={basePath}
        params={search}
        range={range}
        labels={{
          label: d.range.label,
          presets: {
            '7d': d.range.last7,
            '30d': d.range.last30,
            '90d': d.range.last90,
            mtd: d.range.monthToDate,
            all: d.range.all,
          },
          custom: d.range.custom,
          from: d.range.from,
          to: d.range.to,
          apply: d.range.apply,
        }}
      />

      <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-ink">{d.charts.categoriesOverTime}</h2>

        <Toggles
          basePath={basePath}
          search={search}
          series={series}
          selected={selected}
          locale={locale}
        />

        <div className="mt-4">
          <MultiLineChart
            locale={locale}
            days={days}
            series={visible.map((s) => ({
              code: s.code,
              label: locale === 'ru' ? s.nameRu : s.nameEn,
              colorSlot: s.colorSlot,
              values: s.values,
            }))}
            lineNote={d.coverage.lineNote}
            gapNote={d.coverage.gapNote}
            emptyLabel={d.common.noData}
            showTableLabel={d.common.showTable}
            dateLabel={d.fields.publishedAt}
          />
        </div>

        <p className="mt-3 text-xs text-ink-muted">{d.charts.reasonCategoriesNote}</p>
      </section>

      <p className="text-center">
        <Link href={`/${locale}/denials`} className="text-xs text-series-1 hover:underline">
          {d.nav.denials} →
        </Link>
      </p>
    </div>
  )
}

/**
 * Какие категории показывать.
 *
 * Параметр `cats` — явный выбор пользователя. `category` приходит с
 * плитки на сводке: клик по столбику обязан открыть именно эту категорию,
 * а не набор по умолчанию.
 */
function resolveSelection(search: Search, series: CategorySeries[]): Set<string> {
  const known = new Set(series.map((s) => s.code))

  if (search.cats !== undefined) {
    const chosen = search.cats.split(',').filter((code) => known.has(code))
    return new Set(chosen)
  }

  if (search.category && known.has(search.category)) {
    return new Set([search.category])
  }

  return new Set(
    [...series]
      .sort((a, b) => b.total - a.total)
      .slice(0, DEFAULT_VISIBLE)
      .map((s) => s.code),
  )
}

function Toggles({
  basePath,
  search,
  series,
  selected,
  locale,
}: {
  basePath: string
  search: Search
  series: CategorySeries[]
  selected: Set<string>
  locale: Locale
}) {
  const hrefFor = (code: string) => {
    const next = new Set(selected)
    if (next.has(code)) next.delete(code)
    else next.add(code)

    const query = new URLSearchParams()
    if (search.from && search.to) {
      query.set('from', search.from)
      query.set('to', search.to)
    } else if (search.range) {
      query.set('range', search.range)
    }
    // Пустое значение — осознанный «ничего не выбрано», иначе параметр
    // исчез бы и вернулся набор по умолчанию.
    query.set('cats', [...next].join(','))

    return `${basePath}?${query.toString()}`
  }

  return (
    <ul className="mt-3 flex flex-wrap gap-1.5">
      {series.map((s) => {
        const on = selected.has(s.code)
        return (
          <li key={s.code}>
            <Link
              href={hrefFor(s.code)}
              aria-pressed={on}
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ' +
                (on
                  ? 'border-transparent bg-page font-medium text-ink'
                  : 'border-hairline text-ink-muted hover:text-ink')
              }
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: on ? `var(--series-${s.colorSlot})` : 'var(--axis)',
                }}
                aria-hidden="true"
              />
              {locale === 'ru' ? s.nameRu : s.nameEn}
              <span className="tabular-nums text-ink-muted">{formatNumber(locale, s.total)}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
