'use client'

import { useState } from 'react'
import type { Locale } from '@/i18n'
import { formatNumber, formatPercent } from '@/lib/format'

/**
 * Возраст получивших гражданство — кольцевая диаграмма.
 *
 * Кольцевая выбрана заказчиком осознанно. У формы есть цена: группы
 * упорядочены по возрастанию, а круг порядок не показывает, и сравнивать
 * секторы близкой величины на глаз нельзя. Поэтому здесь обязательны
 * легенда со значениями и долями и таблица — и это не украшение, а
 * компенсация: три слота палитры в светлой теме не проходят контраст 3:1,
 * значит цвет не может нести смысл в одиночку.
 *
 * Между секторами оставлен зазор цветом поверхности: без него соседние
 * дуги сливаются в одну при дальтонизме.
 *
 * Сектор и строка легенды подсвечиваются вместе и в обе стороны: связать
 * их по цвету глазами тем труднее, чем ближе секторы по величине, а три
 * слота палитры в светлой теме к тому же не проходят контраст. Подсветка
 * подключается к наведению и к фокусу с клавиатуры.
 */

export type AgeSlice = {
  bucket: string
  label: string
  approvals: number
}

const SIZE = 200
const RADIUS = 70
const THICKNESS = 30
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** Зазор между секторами в единицах длины дуги. */
const GAP = 3

export function AgePieChart({
  locale,
  slices,
  excluded,
  excludedLabel,
  totalLabel,
  showTableLabel,
  bucketLabel,
  countLabel,
  shareLabel,
  emptyLabel,
}: {
  locale: Locale
  slices: AgeSlice[]
  excluded: number
  excludedLabel: string
  totalLabel: string
  showTableLabel: string
  bucketLabel: string
  countLabel: string
  shareLabel: string
  emptyLabel: string
}) {
  const [active, setActive] = useState<string | null>(null)

  const shown = slices.filter((s) => s.approvals > 0)
  const total = shown.reduce((sum, s) => sum + s.approvals, 0)

  if (total === 0) {
    return <p className="text-xs text-ink-secondary">{emptyLabel}</p>
  }

  const lengths = shown.map((slice) => (slice.approvals / total) * CIRCUMFERENCE)

  const arcs = shown.map((slice, index) => ({
    ...slice,
    slot: index + 1,
    share: slice.approvals / total,
    // Зазор съедается у конца дуги; для совсем узких секторов он
    // ограничен, иначе сектор исчез бы целиком.
    dash: Math.max((lengths[index] ?? 0) - GAP, 0.5),
    // Групп семь, поэтому префиксная сумма пересчётом дешевле накопителя
    // и не заводит изменяемое состояние внутри отрисовки.
    offset: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }))

  const activeArc = arcs.find((arc) => arc.bucket === active) ?? null

  return (
    <div>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-40 w-40 shrink-0 sm:h-48 sm:w-48"
          role="img"
          aria-label={`${totalLabel}: ${formatNumber(locale, total)}`}
        >
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {arcs.map((arc) => {
              const dimmed = active !== null && active !== arc.bucket

              return (
                <circle
                  key={arc.bucket}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={`var(--series-${arc.slot})`}
                  // Активный сектор чуть толще, остальные приглушены:
                  // толщина работает и там, где цвет различить трудно.
                  strokeWidth={active === arc.bucket ? THICKNESS + 6 : THICKNESS}
                  strokeOpacity={dimmed ? 0.35 : 1}
                  strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
                  strokeDashoffset={-arc.offset}
                  className="cursor-pointer"
                  onMouseEnter={() => setActive(arc.bucket)}
                  onMouseLeave={() => setActive(null)}
                  onPointerDown={() => setActive(arc.bucket)}
                />
              )
            })}
          </g>
          {/* В центре — итог, а при наведении значение выбранной группы:
              так число не приходится искать глазами в легенде. */}
          <text
            x={SIZE / 2}
            y={SIZE / 2 - 2}
            textAnchor="middle"
            className="fill-ink text-[22px] font-semibold"
          >
            {formatNumber(locale, activeArc ? activeArc.approvals : total)}
          </text>
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 16}
            textAnchor="middle"
            className="fill-ink-muted text-[10px]"
          >
            {activeArc ? activeArc.label : totalLabel}
          </text>
        </svg>

        {/* Легенда со значениями, а не только с названиями: по кольцу
            величины не считываются. */}
        <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-1">
          {arcs.map((arc) => {
            const on = active === arc.bucket

            return (
              <li key={arc.bucket}>
                {/* Кнопка, а не просто строка: подсветка должна работать
                    и с клавиатуры, а не только под курсором. */}
                <button
                  type="button"
                  onMouseEnter={() => setActive(arc.bucket)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(arc.bucket)}
                  onBlur={() => setActive(null)}
                  aria-current={on ? 'true' : undefined}
                  className={
                    'flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left ' +
                    (on ? 'bg-page' : '')
                  }
                >
                  <span
                    className="size-2.5 shrink-0 translate-y-px rounded-[2px]"
                    style={{ backgroundColor: `var(--series-${arc.slot})` }}
                    aria-hidden="true"
                  />
                  <span className={on ? 'font-medium text-ink' : 'text-ink-secondary'}>
                    {arc.label}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-ink">
                    {formatNumber(locale, arc.approvals)}
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-ink-muted">
                    {formatPercent(locale, arc.share, 0)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {excluded > 0 && <p className="mt-4 text-xs text-ink-muted">{excludedLabel}</p>}

      <details className="mt-3 text-xs text-ink-secondary">
        <summary className="cursor-pointer select-none hover:text-ink">{showTableLabel}</summary>
        <div className="mt-2 overflow-hidden rounded-lg border border-hairline">
          <table className="w-full border-collapse text-left [font-variant-numeric:tabular-nums]">
            <thead className="bg-surface">
              <tr className="border-b border-hairline text-ink-muted">
                <th scope="col" className="px-3 py-2 font-medium">{bucketLabel}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{countLabel}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{shareLabel}</th>
              </tr>
            </thead>
            <tbody>
              {arcs.map((arc) => (
                <tr key={arc.bucket} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-3 py-1.5 font-normal text-ink-secondary">
                    {arc.label}
                  </th>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {formatNumber(locale, arc.approvals)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink">
                    {formatPercent(locale, arc.share, 0)}
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
