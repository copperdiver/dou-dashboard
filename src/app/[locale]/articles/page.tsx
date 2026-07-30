import { notFound } from 'next/navigation'
import { Empty, SourceLink } from '@/components/feed/common'
import { Pager } from '@/components/feed/pager'
import { getTranslator, isLocale } from '@/i18n'
import { Flag } from '@/components/flag'
import { formatEditionDate, formatNumber } from '@/lib/format'
import { getArticles } from '@/lib/queries/articles'
import { parseCursor } from '@/lib/queries/feeds'

export const dynamic = 'force-dynamic'

type Search = { cursor?: string }

export default async function ArticlesPage({
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
  const basePath = `/${locale}/articles`

  const page = await getArticles(parseCursor(search.cursor))

  if (page.items.length === 0) {
    return <Empty title={d.feed.empty} hint={d.feed.emptyHint} />
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2.5">
        {page.items.map((item) => (
          <li key={item.id} className="rounded-2xl border border-hairline bg-surface p-3.5 sm:p-4">
            <p className="text-xs tabular-nums text-ink-muted">
              {formatEditionDate(locale, item.editionDate)}
            </p>

            {/* Заголовки источника бывают без пробелов — длинный путь вида
                `.../DNN_Naturalizacao/CPMIG/...` на узком экране распирал бы
                карточку, поэтому разрешаем перенос внутри слова. */}
            <p className="mt-1 text-sm font-medium break-words text-ink">{item.title}</p>

            {/* Нулевые счётчики не показываем: на странице с одними
                прекращениями «Одобрения 0 · Отказы 0» читается как «пусто»,
                хотя решения там есть. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {item.approvals > 0 && (
                <Metric
                  label={d.nav.approvals}
                  value={formatNumber(locale, item.approvals)}
                  slot={1}
                />
              )}
              {item.denials > 0 && (
                <Metric label={d.nav.denials} value={formatNumber(locale, item.denials)} slot={2} />
              )}
              {item.otherDecisions > 0 && (
                <Metric
                  label={d.kpi.decisions30d}
                  value={formatNumber(locale, item.otherDecisions)}
                  slot={4}
                />
              )}
              {item.topCountryIso2 && (
                <span className="text-ink-secondary">
                  <Flag iso2={item.topCountryIso2} className="mr-1.5" />
                  {locale === 'ru' ? item.topCountryRu : item.topCountryEn}
                </span>
              )}
            </div>

            <SourceLink url={item.url} label={d.common.openOriginal} />
          </li>
        ))}
      </ul>

      <Pager basePath={basePath} params={search} next={page.next} label={d.feed.more} />
    </div>
  )
}

/** Счётчик со штрихом цвета серии — тем же, что у ряда на графиках. */
function Metric({ label, value, slot }: { label: string; value: string; slot: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="size-2 shrink-0 translate-y-px rounded-full"
        style={{ backgroundColor: `var(--series-${slot})` }}
        aria-hidden="true"
      />
      <span className="text-ink-secondary">{label}</span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </span>
  )
}
