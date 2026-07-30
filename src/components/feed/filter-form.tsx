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
 * Панель фильтров фида — одной строкой.
 *
 * Обычная GET-форма: значения оказываются в адресе, поиск пересылается
 * ссылкой и работает без JS. Списки — нативные `<select>`: на телефоне
 * они открываются системным барабаном, который удобнее любого своего
 * выпадающего меню и доступен с клавиатуры даром.
 *
 * Подписей над полями нет: название поля стоит первым пунктом списка
 * и подсказкой в поиске, поэтому строка не двоится. Для чтения с экрана
 * имя поля продублировано скрытой подписью.
 *
 * Курсор пагинации в форму не попадает намеренно: смена фильтра обязана
 * возвращать к первой странице, иначе выдача начнётся с середины
 * прежнего, уже неактуального списка.
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
                {/* Пустое значение подписано названием поля: пока фильтр
                    не выбран, список сам себя и называет. */}
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
