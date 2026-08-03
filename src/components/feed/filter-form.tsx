import Link from 'next/link'
import {
  BTN_PRIMARY,
  CONTROL,
  FORM_ROW,
  SELECT,
  TOGGLE_INPUT,
  TOGGLE_KNOB,
  TOGGLE_LABEL,
  TOGGLE_TRACK,
} from '@/components/form-controls'

/**
 * Feed filter panel: a single row.
 *
 * A plain GET form: values end up in the URL, the search can be shared as
 * a link and works without JS. The lists are native `<select>`s: on mobile
 * they open the system picker wheel, which beats any custom dropdown and
 * comes with keyboard accessibility for free.
 *
 * There are no labels above the fields: the field name is the list's first
 * item and the search placeholder, so the row doesn't double up. For
 * screen readers, the field name is duplicated as a hidden label.
 *
 * The pagination cursor deliberately doesn't go into the form: changing a
 * filter must return to the first page, otherwise results would start
 * partway through the previous, now-stale list.
 */

export type SelectField = {
  kind: 'select'
  name: string
  label: string
  value: string
  options: { value: string; label: string }[]
}

export type SearchField = {
  kind: 'search'
  name: string
  label: string
  value: string
}

export type ToggleField = {
  kind: 'toggle'
  name: string
  label: string
  checked: boolean
}

export type Field = SelectField | SearchField | ToggleField

export function FilterForm({
  action,
  fields,
  applyLabel,
  resetLabel,
}: {
  action: string
  fields: Field[]
  applyLabel: string
  resetLabel: string
}) {
  const active = fields.some((field) =>
    field.kind === 'toggle' ? field.checked : field.value !== '',
  )

  return (
    <form method="get" action={action} className={FORM_ROW}>
      {fields.map((field) => {
        if (field.kind === 'select') {
          return (
            <label key={field.name} className="contents">
              <span className="sr-only">{field.label}</span>
              <select
                name={field.name}
                defaultValue={field.value}
                aria-label={field.label}
                className={SELECT}
              >
                {/* The empty value is labeled with the field's name: until a
                    filter is chosen, the list names itself. */}
                <option value="">{field.label}</option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )
        }

        if (field.kind === 'search') {
          return (
            <label key={field.name} className="contents">
              <span className="sr-only">{field.label}</span>
              <input
                type="search"
                name={field.name}
                defaultValue={field.value}
                placeholder={field.label}
                aria-label={field.label}
                className={CONTROL}
              />
            </label>
          )
        }

        return (
          <label key={field.name} className={TOGGLE_LABEL}>
            <input
              type="checkbox"
              name={field.name}
              value="1"
              defaultChecked={field.checked}
              className={TOGGLE_INPUT}
            />
            <span className={TOGGLE_TRACK} aria-hidden="true">
              <span className={TOGGLE_KNOB} />
            </span>
            {field.label}
          </label>
        )
      })}

      <button type="submit" className={BTN_PRIMARY}>
        {applyLabel}
      </button>

      {active && (
        <Link href={action} className="shrink-0 px-1 text-sm text-ink-muted hover:text-ink">
          {resetLabel}
        </Link>
      )}
    </form>
  )
}
