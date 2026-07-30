'use client'

import { useState } from 'react'
import { formatDayShort, formatEditionDate, formatNumber } from '@/lib/format'
import type { Locale } from '@/i18n'
import { niceTicks, smoothPath } from './scale'

/**
 * Одобрения и отказы по дням.
 *
 * Обе серии — счётчики людей, поэтому шкала одна. Второй оси здесь быть
 * не может: два разных нуля на одном поле дают любую нужную «корреляцию».
 *
 * Линия непрерывна и идёт через дни без выпуска: DOU выходит по будням,
 * и на выходных публиковать было нечего — отсутствие события, а не
 * отсутствие знания. Точки стоят на своих календарных местах, поэтому
 * длина пролёта через выходные видна наклоном.
 *
 * День, который не удалось загрузить, — другое дело: там мы просто не
 * знаем, что было. Такие дни помечаются полосой под кривой, чтобы
 * сплошная линия не выдавала пробел в данных за наблюдение.
 */

export type SeriesPoint = {
  day: string
  approvals: number | null
  denials: number | null
  coverage: 'covered' | 'no_edition' | 'missing'
}

type Labels = {
  approvals: string
  denials: string
  lineNote: string
  gapNote: string
  showTable: string
  date: string
  total: string
  noData: string
}

/** Геометрия под ширину экрана: на телефоне поле выше и подписей меньше. */
type Geometry = {
  w: number
  h: number
  pad: { top: number; right: number; bottom: number; left: number }
  xLabels: number
}

const NARROW: Geometry = {
  w: 360,
  h: 250,
  pad: { top: 14, right: 10, bottom: 34, left: 34 },
  xLabels: 4,
}

const WIDE: Geometry = {
  w: 1000,
  h: 360,
  pad: { top: 20, right: 16, bottom: 40, left: 52 },
  xLabels: 9,
}

export function TimeSeriesChart({
  locale,
  data,
  labels,
}: {
  locale: Locale
  data: SeriesPoint[]
  labels: Labels
}) {
  // Индекс активного дня общий для обоих полей: видно всегда только одно,
  // а состояние переживает смену ширины экрана.
  const [active, setActive] = useState<number | null>(null)

  // Предупреждаем только про незагруженные дни. Выходные без выпуска —
  // не пробел в данных, и оговаривать их нечего.
  const hasGap = data.some((p) => p.coverage === 'missing')
  const shown = active !== null && data[active] ? active : lastKnownIndex(data)
  const point = shown === null ? null : data[shown]

  return (
    <div>
      {/*
        Показания вынесены над графиком, а не во всплывающую подсказку под
        курсором: на телефоне палец закрывает ровно ту точку, о которой
        подсказка рассказывает.
      */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        <span className="font-medium text-ink">
          {point ? formatEditionDate(locale, point.day) : '—'}
        </span>
        <Readout
          label={labels.approvals}
          slot={1}
          value={point?.approvals ?? null}
          locale={locale}
          noData={labels.noData}
        />
        <Readout
          label={labels.denials}
          slot={2}
          value={point?.denials ?? null}
          locale={locale}
          noData={labels.noData}
        />
      </div>

      <Plot
        geometry={NARROW}
        className="sm:hidden"
        locale={locale}
        data={data}
        active={active}
        onActive={setActive}
      />
      <Plot
        geometry={WIDE}
        className="hidden sm:block"
        locale={locale}
        data={data}
        active={active}
        onActive={setActive}
      />

      <p className="mt-2 text-xs text-ink-muted">
        {labels.lineNote}
        {hasGap && ` · ${labels.gapNote}`}
      </p>

      <details className="mt-3 text-xs text-ink-secondary">
        <summary className="cursor-pointer select-none hover:text-ink">{labels.showTable}</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-hairline">
          <table className="w-full border-collapse text-left [font-variant-numeric:tabular-nums]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-hairline text-ink-muted">
                <th scope="col" className="px-3 py-2 font-medium">{labels.date}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labels.approvals}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{labels.denials}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.day} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-3 py-1.5 font-normal text-ink-secondary">
                    {formatEditionDate(locale, p.day)}
                  </th>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {p.approvals === null ? '—' : formatNumber(locale, p.approvals)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {p.denials === null ? '—' : formatNumber(locale, p.denials)}
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

function Readout({
  label,
  slot,
  value,
  locale,
  noData,
}: {
  label: string
  slot: number
  value: number | null
  locale: Locale
  noData: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-0.5 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--series-${slot})` }}
        aria-hidden="true"
      />
      <span className="text-ink-secondary">{label}</span>
      <span className="font-semibold text-ink [font-variant-numeric:tabular-nums]">
        {value === null ? noData : formatNumber(locale, value)}
      </span>
    </span>
  )
}

function Plot({
  geometry,
  className,
  locale,
  data,
  active,
  onActive,
}: {
  geometry: Geometry
  className: string
  locale: Locale
  data: SeriesPoint[]
  active: number | null
  onActive: (index: number | null) => void
}) {
  const { w, h, pad, xLabels } = geometry
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom
  const baseline = pad.top + plotH

  const values = data.flatMap((p) => [p.approvals, p.denials]).filter((v): v is number => v !== null)
  const ticks = niceTicks(Math.max(...values, 0))
  const top = ticks[ticks.length - 1] ?? 1

  const x = (index: number) =>
    data.length < 2 ? pad.left + plotW / 2 : pad.left + (index / (data.length - 1)) * plotW
  const y = (value: number) => baseline - (value / top) * plotH

  const labelEvery = Math.max(1, Math.ceil(data.length / xLabels))

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`h-auto w-full ${className}`}
      role="img"
      aria-label={`${data.length}`}
      onMouseLeave={() => onActive(null)}
    >
      {ticks.map((tick) => {
        const ty = y(tick)
        return (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={pad.left + plotW}
              y1={ty}
              y2={ty}
              stroke={tick === 0 ? 'var(--axis)' : 'var(--grid)'}
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={ty + 3.5}
              textAnchor="end"
              className="fill-ink-muted text-[10px] [font-variant-numeric:tabular-nums]"
            >
              {formatNumber(locale, tick)}
            </text>
          </g>
        )
      })}

      {/* Незагруженные дни: штрих у основания. Кривая над ними проходит
          сплошной, но полоса показывает, что там ничего не наблюдали. */}
      {data.map((p, index) =>
        p.coverage === 'missing' ? (
          <rect
            key={`miss-${p.day}`}
            x={x(index) - Math.max(plotW / Math.max(data.length - 1, 1) / 2, 1)}
            y={baseline - 3}
            width={Math.max(plotW / Math.max(data.length - 1, 1), 2)}
            height={3}
            fill="var(--axis)"
          />
        ) : null,
      )}

      {active !== null && data[active] && (
        <line
          x1={x(active)}
          x2={x(active)}
          y1={pad.top}
          y2={baseline}
          stroke="var(--axis)"
          strokeWidth={1}
        />
      )}

      <Line data={data} pick={(p) => p.approvals} slot={1} x={x} y={y} />
      <Line data={data} pick={(p) => p.denials} slot={2} x={x} y={y} />

      {active !== null && data[active] && (
        <>
          <Marker value={data[active].approvals} cx={x(active)} y={y} slot={1} />
          <Marker value={data[active].denials} cx={x(active)} y={y} slot={2} />
        </>
      )}

      {data.map((p, index) =>
        (data.length - 1 - index) % labelEvery === 0 ? (
          <text
            key={p.day}
            x={x(index)}
            y={baseline + 16}
            // Крайние подписи прижимаются к своей стороне: подпись
            // последнего дня стоит ровно на правой границе поля, и по
            // центру половина её уходила бы за край кадра.
            textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
            className="fill-ink-muted text-[10px] [font-variant-numeric:tabular-nums]"
          >
            {formatDayShort(locale, p.day)}
          </text>
        ) : null,
      )}

      {/* Зоны попадания шире марки: на линии толщиной 2px пальцем
          не прицелиться. */}
      {data.map((p, index) => (
        <rect
          key={`hit-${p.day}`}
          x={x(index) - plotW / Math.max(data.length - 1, 1) / 2}
          y={pad.top}
          width={plotW / Math.max(data.length - 1, 1)}
          height={plotH}
          fill="transparent"
          onMouseEnter={() => onActive(index)}
          onPointerDown={() => onActive(index)}
        />
      ))}
    </svg>
  )
}

function Line({
  data,
  pick,
  slot,
  x,
  y,
}: {
  data: SeriesPoint[]
  pick: (p: SeriesPoint) => number | null
  slot: number
  x: (index: number) => number
  y: (value: number) => number
}) {
  /*
   * Точки только там, где решения этого вида публиковались.
   *
   * Ноль отбрасывается наравне с пропуском: одобрения выходят portaria,
   * отказы — despachos, и это разные дни. Ноль отказов в день, когда
   * despachos не публиковался, означает отсутствие публикации, а не
   * решение «отказов ноль», и сажать из-за него линию на ось — значит
   * рисовать провал, которого в предметной области нет.
   *
   * Точки остаются на своих календарных местах, поэтому длина пролёта
   * видна наклоном. Точные значения, включая нули, — в таблице ниже.
   */
  const points = data
    .map((p, index) => ({ index, value: pick(p) }))
    .filter((p): p is { index: number; value: number } => p.value !== null && p.value !== 0)
    .map((p) => ({ x: x(p.index), y: y(p.value) }))

  if (points.length === 0) return null
  if (points.length === 1) {
    return <circle cx={points[0]!.x} cy={points[0]!.y} r={2.5} fill={`var(--series-${slot})`} />
  }

  return (
    <path
      d={smoothPath(points)}
      fill="none"
      stroke={`var(--series-${slot})`}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

function Marker({
  value,
  cx,
  y,
  slot,
}: {
  value: number | null
  cx: number
  y: (value: number) => number
  slot: number
}) {
  if (value === null) return null
  return (
    <circle
      cx={cx}
      cy={y(value)}
      r={4}
      fill={`var(--series-${slot})`}
      // Кольцо цветом поверхности отделяет марку от линии под ней.
      stroke="var(--surface-1)"
      strokeWidth={2}
    />
  )
}

function lastKnownIndex(data: SeriesPoint[]): number | null {
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const p = data[i]
    if (p && (p.approvals !== null || p.denials !== null)) return i
  }
  return null
}
