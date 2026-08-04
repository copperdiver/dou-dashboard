import { notFound } from 'next/navigation'
import { CategoryBarChart } from '@/components/charts/category-bar-chart'
import { DonutChart } from '@/components/charts/donut-chart'
import { TimeSeriesChart } from '@/components/charts/time-series-chart'
import { DateRange } from '@/components/date-range'
import { KpiTile } from '@/components/kpi-tile'
import { getTranslator, isLocale, type Locale } from '@/i18n'
import { formatNumber, formatPercent, relativeChange } from '@/lib/format'
import {
  getAgeDistribution,
  getCountryDistribution,
  getDailySeries,
  getDataBounds,
  getKpis30d,
  getReasonCategoryTotals,
} from '@/lib/queries/overview'
import { addDays, resolveRange, today } from '@/lib/range'
import type { AgeBucket } from '@/db/schema'

// Data changes every few days, but the period comes from the URL,
// so the page is computed per request rather than pre-generated.
export const dynamic = 'force-dynamic'

/** Half a year of trend in the KPI tiles, as the spec asks for. */
const SPARK_DAYS = 180

const AGE_ORDER: AgeBucket[] = ['0-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+']

/**
 * How many sectors the country donut may have. Eight is the size of the
 * palette; beyond it colors would repeat and the legend would stop
 * identifying anything. The last slot goes to the folded tail.
 */
const COUNTRY_SLOTS = 8

type Search = { range?: string; from?: string; to?: string }

export default async function OverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Search>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const search = await searchParams
  const { d, fill } = getTranslator(locale)

  let data: Awaited<ReturnType<typeof loadOverview>>
  try {
    data = await loadOverview(search)
  } catch (error) {
    return <DatabaseUnavailable locale={locale} message={(error as Error).message} />
  }

  const { range, kpis, spark, series, categories, age, country } = data


  return (
    <div className="space-y-4">
      {/* Tiles come first and sit before the period picker on purpose: they
          are computed over a fixed 30 days and don't depend on it.
          The period only controls the charts below and sits next to them. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          locale={locale}
          label={d.kpi.approvals30d}
          value={formatNumber(locale, kpis.approvals)}
          icon="check"
          tint={3}
          slot={3}
          change={relativeChange(kpis.approvals, kpis.prev.approvals)}
          comparedTo={d.kpi.comparedTo}
          unchangedLabel={d.common.unchanged}
          hint={kpis.prev.approvals === 0 ? d.common.noData : undefined}
          spark={spark.approvals}
          sparkLabel={d.charts.approvalsOverTime}
        />
        <KpiTile
          locale={locale}
          label={d.kpi.denials30d}
          value={formatNumber(locale, kpis.denials)}
          icon="cross"
          tint={2}
          slot={2}
          change={relativeChange(kpis.denials, kpis.prev.denials)}
          betterWhenUp={false}
          comparedTo={d.kpi.comparedTo}
          unchangedLabel={d.common.unchanged}
          hint={kpis.prev.denials === 0 ? d.common.noData : undefined}
          spark={spark.denials}
          sparkLabel={d.charts.denialsOverTime}
        />
        <KpiTile
          locale={locale}
          label={d.kpi.denialRate}
          value={formatPercent(locale, kpis.denialRate)}
          icon="percent"
          tint={1}
          slot={1}
          change={relativeChange(kpis.denialRate, kpis.prev.denialRate)}
          betterWhenUp={false}
          comparedTo={d.kpi.comparedTo}
          unchangedLabel={d.common.unchanged}
          hint={kpis.denialRate === null ? d.common.noData : undefined}
          spark={spark.rate}
          sparkLabel={d.kpi.denialRate}
        />
        <KpiTile
          locale={locale}
          label={d.kpi.decisions30d}
          value={formatNumber(locale, kpis.otherDecisions)}
          icon="stack"
          tint={4}
          slot={4}
          change={relativeChange(kpis.otherDecisions, kpis.prev.otherDecisions)}
          comparedTo={d.kpi.comparedTo}
          unchangedLabel={d.common.unchanged}
          hint={kpis.prev.otherDecisions === 0 ? d.common.noData : undefined}
          // What the number is made of: without a breakdown, "other" says
          // nothing, and this tile's composition is not uniform.
          note={[
            `${d.kpi.decisionsArchived} ${formatNumber(locale, kpis.breakdown.archived)}`,
            `${d.kpi.decisionsUpheld} ${formatNumber(locale, kpis.breakdown.upheld)}`,
            `${d.kpi.decisionsOther} ${formatNumber(locale, kpis.breakdown.other)}`,
          ]}
          spark={spark.decisions}
          sparkLabel={d.kpi.decisions30d}
        />
      </section>

      <DateRange
        basePath={`/${locale}`}
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
        <h2 className="text-sm font-semibold text-ink">{d.charts.overTime}</h2>
        <div className="mt-4">
          <TimeSeriesChart
            locale={locale}
            data={series}
            labels={{
              approvals: d.nav.approvals,
              denials: d.nav.denials,
              lineNote: d.coverage.lineNote,
              gapNote: d.coverage.gapNote,
              showTable: d.common.showTable,
              date: d.fields.publishedAt,
              total: d.common.total,
              noData: '—',
            }}
          />
        </div>
      </section>

      {/* Reasons run the full width: it's a ranked bar chart with long
          category names, and halving the width costs it label room. The two
          donuts below are square and read fine side by side. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-ink">{d.charts.reasonCategories}</h2>
        <div className="mt-4">
          <CategoryBarChart
            locale={locale}
            rows={categories.rows.map((c) => ({
              id: c.id,
              code: c.code,
              label: locale === 'ru' ? c.nameRu : c.nameEn,
              colorSlot: c.colorSlot,
              denials: c.denials,
            }))}
            // The denominator is denials with an identified reason, not all
            // of them: a denial with no reason at all can't land in the numerator.
            denialsTotal={categories.classified}
            note={d.charts.reasonCategoriesNote}
            baseNote={fill(d.charts.reasonCategoriesBase, {
              count: formatNumber(locale, categories.classified),
            })}
            unknownNote={
              categories.total > categories.classified
                ? fill(d.charts.reasonsUnknown, {
                    count: formatNumber(locale, categories.total - categories.classified),
                  })
                : undefined
            }
            emptyLabel={d.common.noData}
            drilldownHref={`/${locale}/denials/categories?${searchToQuery(search)}`}
            drilldownLabel={d.charts.openDrilldown}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-ink">{d.charts.ageDistribution}</h2>
          <div className="mt-4">
            <DonutChart
              locale={locale}
              slices={AGE_ORDER.map((bucket) => ({
                id: bucket,
                label: d.ageBuckets[bucket],
                value: age.buckets.find((b) => b.bucket === bucket)?.approvals ?? 0,
              }))}
              excluded={age.excluded}
              excludedLabel={fill(d.charts.ageExcluded, {
                count: formatNumber(locale, age.excluded),
              })}
              totalLabel={d.common.total}
              showTableLabel={d.common.showTable}
              sliceLabel={d.fields.age}
              countLabel={d.nav.approvals}
              shareLabel={d.charts.ofTotal}
              emptyLabel={d.common.noData}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-ink">{d.charts.countryDistribution}</h2>
          <div className="mt-4">
            <DonutChart
              locale={locale}
              slices={[
                ...country.countries.map((c) => ({
                  id: c.iso2,
                  label: locale === 'ru' ? c.nameRu : c.nameEn,
                  value: c.approvals,
                  iso2: c.iso2,
                })),
                // The tail goes last regardless of its size: it isn't a
                // country, and putting it in rank order among countries
                // would read as one.
                ...(country.other.count > 0
                  ? [
                      {
                        id: 'other',
                        label: d.charts.countryOther,
                        value: country.other.approvals,
                      },
                    ]
                  : []),
              ]}
              note={
                country.other.count > 0
                  ? fill(d.charts.countryOtherNote, {
                      count: formatNumber(locale, country.other.count),
                    })
                  : undefined
              }
              excluded={country.excluded}
              excludedLabel={fill(d.charts.countryExcluded, {
                count: formatNumber(locale, country.excluded),
              })}
              totalLabel={d.common.total}
              showTableLabel={d.common.showTable}
              sliceLabel={d.fields.country}
              countLabel={d.nav.approvals}
              shareLabel={d.charts.ofTotal}
              emptyLabel={d.common.noData}
            />
          </div>
        </section>
      </div>
    </div>
  )
}

/** Period parameters for links to neighboring screens. */
function searchToQuery(search: Search): string {
  const params = new URLSearchParams()
  if (search.from && search.to) {
    params.set('from', search.from)
    params.set('to', search.to)
  } else {
    params.set('range', search.range ?? '90d')
  }
  return params.toString()
}

async function loadOverview(search: Search) {
  const bounds = (await getDataBounds()) ?? { min: today(), max: today() }
  const range = resolveRange(search, bounds)
  const anchor = today()

  const [kpis, sparkSeries, series, categories, age, country] = await Promise.all([
    getKpis30d(anchor),
    getDailySeries(addDays(anchor, -(SPARK_DAYS - 1)), anchor),
    getDailySeries(range.from, range.to),
    getReasonCategoryTotals(range.from, range.to),
    getAgeDistribution(range.from, range.to),
    getCountryDistribution(range.from, range.to, COUNTRY_SLOTS),
  ])

  return {
    range,
    kpis,
    spark: {
      approvals: sparkSeries.map((p) => p.approvals),
      denials: sparkSeries.map((p) => p.denials),
      decisions: sparkSeries.map((p) => p.otherDecisions),
      // Share of denials for the day. Known only when both values are known
      // and there were decisions that day at all: otherwise the point isn't "zero", it's missing.
      rate: sparkSeries.map((p) => {
        if (p.approvals === null || p.denials === null) return null
        const total = p.approvals + p.denials
        return total === 0 ? null : p.denials / total
      }),
    },
    series,
    categories,
    age,
    country,
  }
}

function DatabaseUnavailable({ locale, message }: { locale: Locale; message: string }) {
  const { d } = getTranslator(locale)

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="text-critical" aria-hidden="true">
            ✕
          </span>
          {d.db.unavailable}
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-page p-3 text-xs text-ink-secondary">
          {message}
        </pre>
      </div>
    </div>
  )
}
