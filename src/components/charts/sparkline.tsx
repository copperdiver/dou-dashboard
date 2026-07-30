/**
 * Спарклайн для плитки KPI: форма ряда без осей и подписей.
 *
 * Значение несёт число на плитке, спарклайн — только динамику, поэтому
 * шкала не подписана и начинается не от нуля: цель — разглядеть форму,
 * а не считать по ней величины.
 *
 * Дни без наблюдения линия проходит насквозь: DOU выходит по будням,
 * и выходные — это отсутствие события, а не пробел в данных. Ноль вместо
 * них рисовать нельзя, поэтому точки просто не ставятся, а кривая идёт
 * от наблюдения к наблюдению.
 */

import { smoothPath } from './scale'

const W = 120
const H = 32
const PAD = 3

export function Sparkline({
  values,
  slot = 1,
  label,
}: {
  values: (number | null)[]
  /** Слот палитры серий 1..8. */
  slot?: number
  /** Подпись для чтения с экрана: что за ряд. */
  label: string
}) {
  // Шкала строится по тем же значениям, что и линия: если считать её
  // с нулями, форма прижималась бы к низу из-за дней без публикаций.
  const known = values.filter((v): v is number => v !== null && v !== 0)
  if (known.length < 2) return null

  const min = Math.min(...known)
  const max = Math.max(...known)
  const span = max - min || 1

  const x = (index: number) =>
    values.length < 2 ? W / 2 : PAD + (index / (values.length - 1)) * (W - PAD * 2)
  const y = (value: number) => H - PAD - ((value - min) / span) * (H - PAD * 2)

  // Ноль отбрасывается наравне с пропуском — как и на большом графике:
  // это день без публикаций такого вида, а не провал показателя.
  const points = values
    .map((value, index) => ({ index, value }))
    .filter((p): p is { index: number; value: number } => p.value !== null && p.value !== 0)
    .map((p) => ({ x: x(p.index), y: y(p.value) }))

  const lastIndex = values.findLastIndex((v) => v !== null && v !== 0)
  const lastValue = lastIndex >= 0 ? (values[lastIndex] ?? null) : null

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-8 w-full"
      role="img"
      aria-label={label}
    >
      <path
        d={smoothPath(points)}
        fill="none"
        stroke={`var(--series-${slot})`}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // Иначе неравномерное растяжение viewBox раздуло бы линию
        // по горизонтали и сплющило по вертикали.
        vectorEffect="non-scaling-stroke"
      />

      {lastValue !== null && lastIndex >= 0 && (
        <circle cx={x(lastIndex)} cy={y(lastValue)} r={2} fill={`var(--series-${slot})`} />
      )}
    </svg>
  )
}
