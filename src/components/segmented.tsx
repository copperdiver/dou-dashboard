/**
 * Общий вид сегментных переключателей в шапке — язык и тема.
 *
 * Выбранный сегмент помечен не только заливкой: у него `aria-current`
 * либо `aria-pressed`, поэтому состояние доступно и без цвета. Заливка
 * контрастная (чернила на странице), а не оттенок серии: это элемент
 * управления, и путать его с цветом данных нельзя.
 */

export const SEGMENT_GROUP =
  'inline-flex items-center gap-0.5 rounded-full border border-hairline bg-surface p-0.5'

export function segmentClass(active: boolean): string {
  return (
    'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs ' +
    'transition-colors ' +
    (active
      ? 'bg-ink font-medium text-page'
      : 'text-ink-muted hover:bg-page hover:text-ink')
  )
}
