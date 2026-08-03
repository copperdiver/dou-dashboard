/**
 * Shared look for the segmented toggles in the header: language and theme.
 *
 * The selected segment isn't marked by fill alone: it also carries
 * `aria-current` or `aria-pressed`, so the state is accessible without
 * color. The fill is high-contrast (ink on page), not a series tint: this
 * is a UI control, and it must not be mistaken for a data color.
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
