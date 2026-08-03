import Link from 'next/link'

/**
 * Link to the next page of a feed.
 *
 * Cursor-based pagination: the link carries the boundary of the last
 * record shown, not a page number. Going back is handled by the browser:
 * storing reverse cursors just for a custom "back" button isn't worth it.
 */
export function Pager({
  basePath,
  params,
  next,
  label,
}: {
  basePath: string
  /** Current params: filters must not be lost when paging. */
  params: Record<string, string | undefined>
  next: string | null
  label: string
}) {
  if (!next) return null

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'cursor') query.set(key, value)
  }
  query.set('cursor', next)

  return (
    <div className="mt-4 flex justify-center">
      <Link
        href={`${basePath}?${query.toString()}`}
        className="rounded-lg border border-hairline bg-surface px-4 py-2.5 text-xs font-medium text-ink hover:bg-page"
      >
        {label} →
      </Link>
    </div>
  )
}
