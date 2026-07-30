import Link from 'next/link'

/**
 * Переход к следующей странице фида.
 *
 * Курсорная пагинация: ссылка несёт границу последней показанной записи,
 * а не номер страницы. Назад возвращает браузер — хранить обратные
 * курсоры ради своей кнопки «назад» не стоит.
 */
export function Pager({
  basePath,
  params,
  next,
  label,
}: {
  basePath: string
  /** Текущие параметры: фильтры при листании не должны теряться. */
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
