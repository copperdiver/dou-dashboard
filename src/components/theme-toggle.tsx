'use client'

import { useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'dou-theme'

const LABELS: Record<Theme, string> = {
  system: 'Как в системе',
  light: 'Светлая',
  dark: 'Тёмная',
}

/** Скрипт для <head>: ставит тему до первой отрисовки, чтобы не мигало. */
export const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
`

// localStorage — внешнее хранилище, поэтому читаем его через
// useSyncExternalStore, а не синхронизируем в useEffect.
const listeners = new Set<() => void>()
let snapshot: Theme | null = null

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getSnapshot(): Theme {
  if (snapshot === null) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      snapshot = stored === 'light' || stored === 'dark' ? stored : 'system'
    } catch {
      snapshot = 'system'
    }
  }
  return snapshot
}

function getServerSnapshot(): Theme {
  return 'system'
}

function setTheme(next: Theme): void {
  snapshot = next
  try {
    if (next === 'system') {
      delete document.documentElement.dataset.theme
      localStorage.removeItem(STORAGE_KEY)
    } else {
      document.documentElement.dataset.theme = next
      localStorage.setItem(STORAGE_KEY, next)
    }
  } catch {
    // приватный режим — тема просто не запомнится
  }
  for (const listener of listeners) listener()
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return (
    <label className="flex items-center gap-2 text-xs text-ink-secondary">
      <span className="sr-only">Тема оформления</span>
      <select
        value={theme}
        onChange={(event) => setTheme(event.target.value as Theme)}
        className="rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-ink-secondary"
        aria-label="Тема оформления"
      >
        {(Object.keys(LABELS) as Theme[]).map((value) => (
          <option key={value} value={value}>
            {LABELS[value]}
          </option>
        ))}
      </select>
    </label>
  )
}
