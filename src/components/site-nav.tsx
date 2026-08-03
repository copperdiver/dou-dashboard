'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore } from 'react'
import type { Locale } from '@/i18n/config'
import { NAV_COOKIE, writeUiCookie } from '@/lib/ui-state'

/**
 * Studio mark. Two files instead of one: gold gets lost on white, gray
 * gets lost on dark. Both variants are in the markup, the unused one
 * hidden by CSS: this way the theme switch needs neither JS nor a refetch.
 */
function StudioMark({ size }: { size: number }) {
  // alt is set on each tag rather than spread from an object: the a11y
  // lint rule doesn't see it through a spread, and disabling the rule
  // for brevity isn't worth it.
  return (
    <>
      <Image
        src="/copperdiver-light.png"
        alt=""
        width={size}
        height={size}
        className="logo-light shrink-0"
      />
      <Image
        src="/copperdiver.png"
        alt=""
        width={size}
        height={size}
        className="logo-dark shrink-0"
      />
    </>
  )
}

/** A navigation section. `href` is a path within the locale, empty for the root one. */
export type NavItem = {
  href: string
  label: string
  icon: IconName
}

type IconName = 'overview' | 'approvals' | 'denials' | 'articles' | 'health'

/*
 * Icons are inlined: five of them per app aren't worth a dependency, and
 * currentColor gives them theming and active state for free.
 */
const ICONS: Record<IconName, React.ReactNode> = {
  overview: <path d="M3 13h6v8H3zM9 3h6v18H9zM15 9h6v12h-6z" />,
  approvals: <path d="M20 6 9 17l-5-5" />,
  denials: <path d="M18 6 6 18M6 6l12 12" />,
  articles: <path d="M4 5h16v14H4zM8 9h8M8 13h8M8 17h5" />,
  health: <path d="M3 12h4l2-6 4 12 2-6h6" />,
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 shrink-0"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

/* ── "Collapsed" state ─────────────────────────────────────────────────── */

/*
 * The width is set by a CSS variable on <html>, so the state lives there
 * too: otherwise the content padding would have to be synced separately.
 * The server sets the attribute from a cookie (see src/lib/ui-state.ts
 * for why not localStorage).
 */
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getSnapshot(): boolean {
  return document.documentElement.dataset.nav === 'collapsed'
}

function getServerSnapshot(): boolean {
  return false
}

function setCollapsed(next: boolean): void {
  if (next) {
    document.documentElement.dataset.nav = 'collapsed'
    writeUiCookie(NAV_COOKIE, 'collapsed')
  } else {
    delete document.documentElement.dataset.nav
    writeUiCookie(NAV_COOKIE, null)
  }
  for (const listener of listeners) listener()
}

/* ── Navigation ────────────────────────────────────────────────────────── */

export type NavLabels = {
  /** Accessible name for the whole navigation. */
  title: string
  collapse: string
  expand: string
}

/**
 * Navigation. A client component only for highlighting the active section
 * and the "collapsed" state; the links themselves are plain and work without JS.
 *
 * On mobile it's a panel fixed to the bottom: the thumb reaches the bottom
 * of the screen, not the header. With `sm:` it turns into a sidebar at the
 * left edge, which collapses down to icons only.
 *
 * The list of sections comes from outside: hardcoding it here would mean
 * keeping links to pages that don't exist yet.
 */
export function SiteNav({
  locale,
  items,
  labels,
}: {
  locale: Locale
  items: NavItem[]
  labels: NavLabels
}) {
  const pathname = usePathname()
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // A single section: showing a "switcher" with one tab would be dishonest.
  if (items.length < 2) return null

  return (
    <nav
      aria-label={labels.title}
      className={
        'fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface ' +
        'pb-[env(safe-area-inset-bottom,0px)] ' +
        // On desktop: a full-height column at the very edge of the screen.
        'sm:inset-x-auto sm:top-0 sm:left-0 sm:h-dvh sm:w-[var(--nav-w)] ' +
        'sm:flex sm:flex-col sm:border-t-0 sm:border-r sm:pb-0'
      }
    >
      {/* Collapse button, at the top of the panel, desktop only:
          on mobile the panel is already icons-only. */}
      <div
        className={
          'hidden sm:flex sm:h-12 sm:shrink-0 sm:items-center sm:border-b sm:border-hairline sm:px-2 ' +
          (collapsed ? 'sm:justify-center' : 'sm:justify-end')
        }
      >
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          title={collapsed ? labels.expand : labels.collapse}
          className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-page hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-5"
            aria-hidden="true"
          >
            {/* Panel with an arrow: the direction shows which way the menu will move. */}
            <path d="M4 5h16v14H4zM10 5v14" />
            <path d={collapsed ? 'M14 10l2 2-2 2' : 'M17 10l-2 2 2 2'} />
          </svg>
          <span className="sr-only">{collapsed ? labels.expand : labels.collapse}</span>
        </button>
      </div>

      <ul
        className={
          'mx-auto flex w-full max-w-6xl items-stretch px-2 ' +
          'sm:mx-0 sm:min-h-0 sm:flex-1 sm:flex-col sm:items-stretch sm:gap-1 sm:overflow-y-auto sm:p-2'
        }
      >
        {items.map((item) => {
          const href = `/${locale}${item.href}`
          const active = item.href === '' ? pathname === href : pathname.startsWith(href)

          return (
            // min-w-0 is required: a flex item's min-width defaults to
            // auto, so a long label keeps the tab from shrinking and
            // blows the panel out past the screen edge.
            //
            // The "status" section is hidden on mobile: it's a utility
            // section, and the fifth spot in the bottom bar is taken by
            // the studio mark. On desktop it stays in the sidebar.
            <li
              key={href}
              className={
                'min-w-0 flex-1 sm:flex-none ' +
                (item.icon === 'health' ? 'hidden sm:block' : '')
              }
            >
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                // The tooltip is only needed for the collapsed menu: the label is hidden there.
                title={collapsed ? item.label : undefined}
                className={
                  // 56px tall: the minimum comfortable touch target.
                  'flex h-14 flex-col items-center justify-center gap-1 text-[11px] ' +
                  'sm:h-9 sm:flex-row sm:gap-2.5 sm:rounded-lg sm:px-2.5 sm:text-xs ' +
                  (collapsed ? 'sm:justify-center' : 'sm:justify-start') +
                  ' ' +
                  (active
                    ? 'font-medium text-series-1 sm:bg-page sm:text-ink'
                    : 'text-ink-muted hover:text-ink sm:hover:bg-page')
                }
              >
                <Icon name={item.icon} />
                <span
                  className={
                    'max-w-full truncate px-1 sm:px-0 ' + (collapsed ? 'sm:sr-only' : '')
                  }
                >
                  {item.label}
                </span>
              </Link>
            </li>
          )
        })}

        {/* Studio mark in the fifth tab slot, mobile only:
            on desktop it sits at the bottom of the sidebar. */}
        <li className="min-w-0 flex-1 sm:hidden">
          <a
            href="https://copperdiver.studio/"
            target="_blank"
            rel="noreferrer"
            className="flex h-14 flex-col items-center justify-center gap-1 text-[11px] text-ink-muted"
          >
            <StudioMark size={20} />
            <span className="max-w-full truncate px-1">copperdiver</span>
          </a>
        </li>
      </ul>

      {/*
        Studio label, at the bottom of the sidebar, desktop only: there's no
        room for it in the mobile bottom bar, so the link stays in the page footer there.
        The collapsed menu shows just the mark, the label moves into the tooltip.
      */}
      <a
        href="https://copperdiver.studio/"
        target="_blank"
        rel="noreferrer"
        title="copperdiver.studio"
        className={
          'hidden sm:flex sm:h-12 sm:shrink-0 sm:items-center sm:gap-2.5 sm:border-t ' +
          'sm:border-hairline sm:px-3 sm:text-xs sm:text-ink-muted sm:hover:text-ink ' +
          (collapsed ? 'sm:justify-center' : 'sm:justify-start')
        }
      >
        <StudioMark size={20} />
        <span className={collapsed ? 'sr-only' : ''}>copperdiver.studio</span>
      </a>
    </nav>
  )
}
