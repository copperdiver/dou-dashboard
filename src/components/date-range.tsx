import Link from 'next/link'
import { BTN_OUTLINE, DATE, FORM_ROW } from '@/components/form-controls'
import { RANGE_PRESETS, type RangePreset, type ResolvedRange } from '@/lib/range'

/**
 * Выбор периода.
 *
 * Пресеты — обычные ссылки, произвольный диапазон — GET-форма. Ни то,
 * ни другое не требует JS, а выбранный период оказывается в адресе,
 * поэтому вид пересылается ссылкой и переживает перезагрузку.
 */

/** Все переключатели периода выглядят одинаково, включая «Произвольный». */
function pillClass(active: boolean): string {
  return (
    'inline-block rounded-full px-3 py-1.5 text-xs whitespace-nowrap ' +
    (active
      ? 'bg-ink font-medium text-page'
      : 'border border-hairline bg-surface text-ink-secondary hover:text-ink')
  )
}

export type RangeLabels = {
  label: string
  presets: Record<RangePreset, string>
  custom: string
  from: string
  to: string
  apply: string
}

export function DateRange({
  basePath,
  params,
  range,
  labels,
}: {
  /** Путь без параметров, например `/ru`. */
  basePath: string
  /** Текущие параметры адреса: остальные фильтры не должны теряться. */
  params: Record<string, string | undefined>
  range: ResolvedRange
  labels: RangeLabels
}) {
  /** Остальные параметры адреса: фильтры при смене периода не теряются. */
  const kept = () => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== 'range' && key !== 'from' && key !== 'to') next.set(key, value)
    }
    return next
  }

  const hrefFor = (preset: RangePreset) => {
    const next = kept()
    next.set('range', preset)
    return `${basePath}?${next.toString()}`
  }

  /*
   * «Произвольный» — такая же ссылка, как пресеты, и ведёт на текущие
   * границы, выписанные явными датами. Пресет становится `custom`, форма
   * ниже раскрывается сама. Раскрывающегося блока здесь нет намеренно:
   * ссылки внутри <summary> одновременно переключали бы его и уводили
   * на другую страницу.
   */
  const customHref = () => {
    const next = kept()
    next.set('from', range.from)
    next.set('to', range.to)
    return `${basePath}?${next.toString()}`
  }

  const isCustom = range.preset === 'custom'

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-ink-muted">{labels.label}</span>
        {/* Отрицательные поля и обратный паддинг: на узком экране ряд
            прокручивается от края до края, а не обрезается по контейнеру.
            min-w-0 не даёт списку пресетов растянуть строку: иначе
            flex-элемент отказывается сжиматься ниже своего содержимого
            и горизонтальная прокрутка уезжает на всю страницу. */}
        <div className="-mx-4 min-w-0 flex-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex min-w-max items-center gap-1.5">
            {RANGE_PRESETS.map((preset) => (
              <li key={preset}>
                <Link
                  href={hrefFor(preset)}
                  aria-current={range.preset === preset ? 'true' : undefined}
                  className={pillClass(range.preset === preset)}
                >
                  {labels.presets[preset]}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={customHref()}
                aria-current={isCustom ? 'true' : undefined}
                className={pillClass(isCustom)}
              >
                {labels.custom}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      {isCustom && (
        <form method="get" action={basePath} className={`mt-2 ${FORM_ROW}`}>
          {Object.entries(params).map(([key, value]) =>
            value && key !== 'range' && key !== 'from' && key !== 'to' ? (
              <input key={key} type="hidden" name={key} value={value} />
            ) : null,
          )}
          {/* Подписи «С» и «По» стоят перед полями, а не над ними: строка
              одна, и надстрочные подписи ломали бы её высоту. */}
          <label className="inline-flex items-center gap-2 text-sm text-ink-muted">
            {labels.from}
            <input type="date" name="from" defaultValue={range.from} className={DATE} />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-ink-muted">
            {labels.to}
            <input type="date" name="to" defaultValue={range.to} className={DATE} />
          </label>
          <button type="submit" className={BTN_OUTLINE}>
            {labels.apply}
          </button>
        </form>
      )}
    </div>
  )
}
