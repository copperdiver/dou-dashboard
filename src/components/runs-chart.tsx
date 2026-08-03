'use client'

import { useState } from 'react'
import type { Dictionary, Locale } from '@/i18n'
import { interpolate } from '@/i18n'
import type { DailyRuns } from '@/lib/stats'
import { formatDayShort, formatNumber } from '@/lib/format'

/*
 * Labels arrive as a prop rather than the whole dictionary: the component
 * is a client component, and everything it receives ships to the browser.
 * Only these keys are needed: nothing else should be in the payload.
 */
type ChartLabels = Pick<
  Dictionary['jobs'],
  'dailyChartAlt' | 'emptyChart' | 'colDate' | 'success' | 'failure'
> &
  Pick<Dictionary['common'], 'showTable' | 'total'>

/** Legend labels, the same pair of series as in the tooltip. */
type LegendLabels = Pick<Dictionary['jobs'], 'success' | 'failure'>

// viewBox units are chosen to match CSS pixels on desktop:
// otherwise scaling would inflate the bar thickness and label size.
const W = 1000
const H = 330
const PAD = { top: 20, right: 16, bottom: 40, left: 52 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const BASELINE_Y = PAD.top + PLOT_H

const MAX_BAR = 24 // bar thickness is capped
const SEGMENT_GAP = 2 // surface-colored gap between stacked segments
const CORNER = 4 // rounding on the stack's top end
const MIN_SEGMENT = 2 // so a single run stays visible

/**
 * Y-axis labels: a "nice" step with 3-5 intervals and minimal headroom.
 * Otherwise a scale going to 1500 with a max of 1119 eats a quarter of the height.
 */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]

  const magnitude = 10 ** Math.floor(Math.log10(max))
  const candidates = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5].map((m) => m * magnitude)

  let step = magnitude
  let bestTop = Infinity
  for (const candidate of candidates) {
    const top = Math.ceil(max / candidate) * candidate
    const intervals = Math.round(top / candidate)
    if (intervals < 3 || intervals > 5) continue
    if (top < bestTop) {
      bestTop = top
      step = candidate
    }
  }

  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = 0; value <= top + step / 1000; value += step) {
    ticks.push(Math.round(value * 1000) / 1000)
  }
  return ticks
}

/** A rectangle with a rounded top and a flat base. */
function topRoundedPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height))
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    'Z',
  ].join(' ')
}

export function RunsChart({
  locale,
  data,
  /** Already-agreed "14 days": the server handles plural forms. */
  dayCount,
  labels,
}: {
  locale: Locale
  data: DailyRuns[]
  dayCount: string
  labels: ChartLabels
}) {
  const [active, setActive] = useState<number | null>(null)

  const totals = data.map((day) => day.success + day.failed)
  const grandTotal = totals.reduce((sum, value) => sum + value, 0)
  const ticks = niceTicks(Math.max(...totals, 0))
  const scaleTop = ticks[ticks.length - 1] ?? 1

  const band = PLOT_W / Math.max(data.length, 1)
  const barWidth = Math.min(MAX_BAR, band * 0.62)
  const toPx = (value: number) => (value / scaleTop) * PLOT_H
  const peakIndex = totals.indexOf(Math.max(...totals))

  const bars = data.map((day, index) => {
    const centerX = PAD.left + band * (index + 0.5)
    const x = centerX - barWidth / 2

    const successH = day.success > 0 ? Math.max(MIN_SEGMENT, toPx(day.success)) : 0
    const failedH = day.failed > 0 ? Math.max(MIN_SEGMENT, toPx(day.failed)) : 0
    const gap = successH > 0 && failedH > 0 ? SEGMENT_GAP : 0

    const successY = BASELINE_Y - successH
    const failedY = successY - gap - failedH
    const topY = failedH > 0 ? failedY : successY

    return {
      ...day,
      label: formatDayShort(locale, day.day),
      index,
      centerX,
      x,
      successH,
      failedH,
      successY,
      failedY,
      topY,
      total: day.success + day.failed,
    }
  })

  const activeBar = active === null ? null : bars[active] ?? null
  const mirrorTooltip = activeBar !== null && activeBar.centerX > W * 0.62

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={interpolate(labels.dailyChartAlt, { days: dayCount })}
        onMouseLeave={() => setActive(null)}
      >
        {/* grid and Y-axis labels */}
        {ticks.map((tick) => {
          const y = BASELINE_Y - toPx(tick)
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_W}
                y1={y}
                y2={y}
                stroke={tick === 0 ? 'var(--axis)' : 'var(--grid)'}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-ink-muted text-[10px] [font-variant-numeric:tabular-nums]"
              >
                {formatNumber(locale, tick)}
              </text>
            </g>
          )
        })}

        {/* active day highlight */}
        {activeBar && (
          <rect
            x={activeBar.centerX - band / 2}
            y={PAD.top}
            width={band}
            height={PLOT_H}
            fill="var(--grid)"
            opacity={0.45}
          />
        )}

        {/* bars; the hovered one lightens slightly for cursor feedback */}
        {bars.map((bar) => (
          <g key={bar.day} filter={active === bar.index ? 'brightness(1.12)' : undefined}>
            {bar.successH > 0 && (
              <path
                d={
                  bar.failedH > 0
                    ? `M ${bar.x} ${BASELINE_Y} L ${bar.x} ${bar.successY} L ${bar.x + barWidth} ${bar.successY} L ${bar.x + barWidth} ${BASELINE_Y} Z`
                    : topRoundedPath(bar.x, bar.successY, barWidth, bar.successH, CORNER)
                }
                fill="var(--series-1)"
              />
            )}
            {bar.failedH > 0 && (
              <path
                d={topRoundedPath(bar.x, bar.failedY, barWidth, bar.failedH, CORNER)}
                fill="var(--series-2)"
              />
            )}
          </g>
        ))}

        {/* direct label, peak day only */}
        {grandTotal > 0 && bars[peakIndex] && (
          <text
            x={bars[peakIndex].centerX}
            y={bars[peakIndex].topY - 6}
            textAnchor="middle"
            className="fill-ink-secondary text-[10px] font-semibold [font-variant-numeric:tabular-nums]"
          >
            {formatNumber(locale, bars[peakIndex].total)}
          </text>
        )}

        {/* X-axis labels, every other day; the last day is always labeled */}
        {bars.map((bar) =>
          (data.length - 1 - bar.index) % 2 === 0 ? (
            <text
              key={bar.day}
              x={bar.centerX}
              y={BASELINE_Y + 16}
              textAnchor="middle"
              className="fill-ink-muted text-[10px] [font-variant-numeric:tabular-nums]"
            >
              {bar.label}
            </text>
          ) : null,
        )}

        {/* hover zones, wider than the bar, so the mouse can hit them easily */}
        {bars.map((bar) => (
          <rect
            key={`hit-${bar.day}`}
            x={bar.centerX - band / 2}
            y={PAD.top}
            width={band}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setActive(bar.index)}
          />
        ))}
      </svg>

      {grandTotal === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-lg border border-hairline bg-surface px-3 py-2 text-xs text-ink-secondary">
            {labels.emptyChart}
          </p>
        </div>
      )}

      {activeBar && (
        /*
         * The tooltip sits beside the bar, not above it: bars fill the whole
         * height of the plot area, and a centered tooltip would cover
         * exactly the bar it's describing. Near the right edge, we mirror it.
         */
        <div
          className="pointer-events-none absolute z-10 w-max rounded-lg border border-hairline bg-surface px-3 py-2 text-xs shadow-sm"
          style={{
            left: `${
              ((activeBar.centerX + (mirrorTooltip ? -1 : 1) * (barWidth / 2 + 10)) / W) * 100
            }%`,
            top: `${(Math.max(activeBar.topY, 64) / H) * 100}%`,
            transform: mirrorTooltip ? 'translate(-100%, -20%)' : 'translate(0, -20%)',
          }}
        >
          <div className="text-ink-secondary">{activeBar.label}</div>
          {/* The value is primary, the series name secondary. The series key
              is a short tick in its color, not a fill. */}
          <dl className="mt-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-3 shrink-0 rounded-full bg-series-1" aria-hidden="true" />
              <dt className="text-ink-secondary">{labels.success}</dt>
              <dd className="ml-auto font-semibold text-ink [font-variant-numeric:tabular-nums]">
                {formatNumber(locale, activeBar.success)}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-3 shrink-0 rounded-full bg-series-2" aria-hidden="true" />
              <dt className="text-ink-secondary">{labels.failure}</dt>
              <dd className="ml-auto font-semibold text-ink [font-variant-numeric:tabular-nums]">
                {formatNumber(locale, activeBar.failed)}
              </dd>
            </div>
            <div className="flex items-center gap-2 border-t border-hairline pt-0.5">
              <dt className="text-ink-secondary">{labels.total}</dt>
              <dd className="ml-auto font-semibold text-ink [font-variant-numeric:tabular-nums]">
                {formatNumber(locale, activeBar.total)}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <details className="mt-3 text-xs text-ink-secondary">
        <summary className="cursor-pointer select-none hover:text-ink">{labels.showTable}</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-hairline">
          <table className="w-full border-collapse text-left [font-variant-numeric:tabular-nums]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-hairline text-ink-muted">
                <th scope="col" className="px-3 py-2 font-medium">{labels.colDate}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labels.success}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labels.failure}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labels.total}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((day) => (
                <tr key={day.day} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-3 py-1.5 font-normal text-ink-secondary">
                    {day.day}
                  </th>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {formatNumber(locale, day.success)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {formatNumber(locale, day.failed)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {formatNumber(locale, day.success + day.failed)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

/** The legend echoes the marker's shape: a rectangle for bars. */
export function RunsChartLegend({ labels }: { labels: LegendLabels }) {
  return (
    <div className="flex items-center gap-4 text-xs text-ink-secondary">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[2px] bg-series-1" aria-hidden="true" />
        {labels.success}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[2px] bg-series-2" aria-hidden="true" />
        {labels.failure}
      </span>
    </div>
  )
}
