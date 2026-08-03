'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

/**
 * Periodically refetches the page's server data.
 * No time formatting in the markup: otherwise SSR and client would diverge.
 *
 * The interval label arrives as a ready-made string: the server formats the
 * interval with the same `formatDuration` used for other durations on the page.
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
