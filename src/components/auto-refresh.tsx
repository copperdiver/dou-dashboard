'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

/**
 * Периодически перезапрашивает серверные данные страницы.
 * Никаких форматов времени в разметке — иначе SSR и клиент расходятся.
 *
 * Подпись интервала приходит готовой строкой: интервал форматирует сервер
 * тем же `formatDuration`, что и остальные длительности на странице.
 */
export function AutoRefresh({
  intervalMs,
  labels,
}: {
  intervalMs: number
  labels: { every: string; refresh: string; refreshing: string }
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      startTransition(() => router.refresh())
    }, intervalMs)
    return () => clearInterval(timer)
  }, [enabled, intervalMs, router])

  return (
    <div className="flex items-center gap-3 text-xs text-ink-secondary">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-3.5 accent-series-1"
        />
        {labels.every}
      </label>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        className="rounded-md border border-hairline bg-surface px-2 py-1 hover:text-ink"
      >
        {pending ? labels.refreshing : labels.refresh}
      </button>
    </div>
  )
}
