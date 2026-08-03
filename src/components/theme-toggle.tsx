'use client'

import { useSyncExternalStore } from 'react'
import type { Dictionary } from '@/i18n'
import { SEGMENT_GROUP, segmentClass } from '@/components/segmented'
import { THEME_COOKIE, writeUiCookie, type Theme } from '@/lib/ui-state'

/** Segment order: the default value comes first. */
const THEMES: Theme[] = ['system', 'light', 'dark']

/*
 * Icons: monitor is "match system", sun is light, moon is dark.
 * The mode's name stays in the tooltip and the hidden label, because
 * the icon alone doesn't carry an unambiguous meaning.
 */
const ICONS: Record<Theme, React.ReactNode> = {
  system: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
}

/*
 * The source of truth is the attribute on <html>, set by the server from a
 * cookie. We read it via useSyncExternalStore rather than keep a copy in
 * state: on client-side navigation the component remounts, and the copy
 * would drift out of sync with the markup.
 */
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getSnapshot(): Theme {
  const value = document.documentElement.dataset.theme
  return value === 'light' || value === 'dark' ? value : 'system'
}

function getServerSnapshot(): Theme {
  return 'system'
}

function setTheme(next: Theme): void {
  // The attribute is updated right away: the click's feedback must be
  // instant, and the cookie will be picked up by the next server render.
  if (next === 'system') {
    delete document.documentElement.dataset.theme
    writeUiCookie(THEME_COOKIE, null)
  } else {
    document.documentElement.dataset.theme = next
    writeUiCookie(THEME_COOKIE, next)
  }
  for (const listener of listeners) listener()
}

export function ThemeToggle({
  label,
  labels,
}: {
  label: string
  labels: Dictionary['theme']
}) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return (
    <div className={SEGMENT_GROUP} role="group" aria-label={label}>
      {THEMES.map((value) => {
        const active = value === theme

        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            // aria-pressed, not just the fill: the selected mode must be
            // readable by assistive technology, not by color alone.
            aria-pressed={active}
            title={labels[value]}
            className={segmentClass(active)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
              aria-hidden="true"
            >
              {ICONS[value]}
            </svg>
            <span className="sr-only">{labels[value]}</span>
          </button>
        )
      })}
    </div>
  )
}
