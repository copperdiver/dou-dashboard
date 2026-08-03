/**
 * Form elements: feed filters and the custom date range.
 *
 * Everything lives on one line, so there are no labels above the fields:
 * the field itself plays that role: for a select it's the first option
 * ("Country of birth"), for search it's the placeholder inside. The
 * accessible name isn't lost, though: a hidden label and `aria-label` sit
 * alongside, otherwise the field would be nameless to a screen reader.
 *
 * All controls share one height (36px), set explicitly: `select`, `input`,
 * and `button` all have different default internal padding, and without a
 * shared height the row drifts by a couple of pixels.
 */

const BASE =
  'h-9 rounded-lg border border-hairline bg-page px-3 text-sm text-ink transition-shadow ' +
  'focus:border-series-1 focus:ring-4 focus:ring-series-1/20 focus:outline-none'

/**
 * Input field. Full width on a narrow screen, then takes up the rest of
 * the row. `min-w-0` is required: without it a flex item won't shrink
 * below its content's width, and the row would wrap its tail onto a
 * second line.
 */
export const CONTROL = `${BASE} w-full sm:w-auto sm:min-w-0 sm:flex-1`

/** Native select: room on the right for the system arrow. */
export const SELECT = `${BASE} w-full pr-9 sm:w-auto sm:min-w-44`

/** Date field: width fits its content, otherwise the browser stretches it to fill the row. */
export const DATE = `${BASE} w-full sm:w-auto`

export const BTN_PRIMARY =
  'inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-ink px-4 text-sm ' +
  'font-medium text-page transition-opacity hover:opacity-90 ' +
  'focus:ring-4 focus:ring-series-1/20 focus:outline-none'

export const BTN_OUTLINE =
  'inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-hairline ' +
  'bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-page ' +
  'focus:ring-4 focus:ring-series-1/20 focus:outline-none'

/** Form wrapper: one row on a wide screen, wraps on a narrow one. */
export const FORM_ROW =
  'flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-surface p-2.5'

/*
 * Toggle switch instead of a checkbox.
 *
 * The native `input` stays in place and is only visually hidden: it
 * still carries the state and field name, submits with the form, and
 * gives keyboard focus plus the "switch, on" announcement. A track with
 * a knob is drawn on top. The knob is moved by the `peer-checked:[&>span]`
 * rule, since a plain `peer-*` requires the target to be a sibling, and
 * the knob is nested inside the track.
 */
export const TOGGLE_INPUT = 'peer sr-only'

export const TOGGLE_TRACK =
  'relative h-6 w-10 shrink-0 rounded-full bg-grid transition-colors ' +
  'peer-checked:bg-series-1 ' +
  'peer-focus-visible:ring-4 peer-focus-visible:ring-series-1/20 ' +
  'peer-checked:[&>span]:translate-x-4'

export const TOGGLE_KNOB =
  'absolute top-0.5 left-0.5 size-5 rounded-full bg-surface shadow-sm transition-transform'

export const TOGGLE_LABEL = 'inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 px-1 text-sm text-ink-secondary'
