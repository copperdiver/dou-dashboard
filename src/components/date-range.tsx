import Link from 'next/link'
import { BTN_OUTLINE, DATE, FORM_ROW } from '@/components/form-controls'
import { RANGE_PRESETS, type RangePreset, type ResolvedRange } from '@/lib/range'

/**
 * Period picker.
 *
 * Presets are plain links, the custom range is a GET form. Neither needs
 * JS, and the selected period ends up in the URL, so the view can be
 * shared as a link and survives a reload.
 */

/** All period toggles look the same, including "Custom". */
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
  /** Path without params, e.g. `/ru`. */
  basePath: string
  /** Current URL params: the other filters must not be lost. */
  params: Record<string, string | undefined>
  range: ResolvedRange
  labels: RangeLabels
}) {
  /** The other URL params: filters aren't lost when the period changes. */
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
   * "Custom" is a link just like the presets, pointing at the current
   * bounds spelled out as explicit dates. The preset becomes `custom`, and
   * the form below expands on its own. There's no <details> element here
   * on purpose: links inside a <summary> would both toggle it and
   * navigate away at the same time.
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
        {/* Negative margins and compensating padding: on a narrow screen the
            row scrolls edge to edge instead of being clipped by the container.
            min-w-0 keeps the preset list from stretching the row: otherwise a
            flex item refuses to shrink below its content's size, and the
            horizontal scroll spills out across the whole page. */}
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
          {/* The "From" and "To" labels sit before the fields, not above them:
              it's a single row, and stacked labels would break its height. */}
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
