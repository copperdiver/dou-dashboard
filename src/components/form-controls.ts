/**
 * Элементы форм: фильтры фидов и произвольный период.
 *
 * Всё живёт одной строкой, поэтому подписей над полями нет — их роль
 * играет само поле: у списка это первый пункт («Страна рождения»),
 * у поиска подсказка внутри. Доступное имя при этом не теряется: рядом
 * идёт скрытая подпись и `aria-label`, иначе поле осталось бы безымянным
 * для чтения с экрана.
 *
 * Высота у всех контролов одна (36px) и задана явно: у `select`, `input`
 * и `button` разные внутренние отступы по умолчанию, и без общей высоты
 * строка «плывёт» на пару пикселей.
 */

const BASE =
  'h-9 rounded-lg border border-hairline bg-page px-3 text-sm text-ink transition-shadow ' +
  'focus:border-series-1 focus:ring-4 focus:ring-series-1/20 focus:outline-none'

/**
 * Поле ввода. На узком экране во всю ширину, дальше забирает остаток
 * строки. `min-w-0` обязателен: без него flex-элемент не сжимается ниже
 * своего содержимого, и строка переносила бы хвост на вторую.
 */
export const CONTROL = `${BASE} w-full sm:w-auto sm:min-w-0 sm:flex-1`

/** Нативный список: место справа под системную стрелку. */
export const SELECT = `${BASE} w-full pr-9 sm:w-auto sm:min-w-44`

/** Поле даты: ширина по содержимому, иначе браузер растягивает его на всю строку. */
export const DATE = `${BASE} w-full sm:w-auto`

export const BTN_PRIMARY =
  'inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-ink px-4 text-sm ' +
  'font-medium text-page transition-opacity hover:opacity-90 ' +
  'focus:ring-4 focus:ring-series-1/20 focus:outline-none'

export const BTN_OUTLINE =
  'inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-hairline ' +
  'bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-page ' +
  'focus:ring-4 focus:ring-series-1/20 focus:outline-none'

/** Обёртка формы: одна строка на широком экране, перенос на узком. */
export const FORM_ROW =
  'flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-surface p-2.5'

/*
 * Переключатель вместо флажка.
 *
 * Нативный `input` остаётся на месте и лишь скрыт: он несёт состояние,
 * имя поля и отправляется формой, а также даёт фокус с клавиатуры и
 * объявление «переключатель, включён». Рисуется дорожка с бегунком —
 * бегунок двигает правило `peer-checked:[&>span]`, потому что обычный
 * `peer-*` требует соседства на одном уровне, а бегунок вложен в дорожку.
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
