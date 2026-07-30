'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore } from 'react'
import type { Locale } from '@/i18n/config'
import { NAV_COOKIE, writeUiCookie } from '@/lib/ui-state'

/**
 * Знак студии. Два файла вместо одного: на белом золото теряется, на
 * тёмном теряется серый. Оба варианта в разметке, лишний скрыт стилями —
 * так переключение темы не требует ни JS, ни повторного запроса.
 */
function StudioMark({ size }: { size: number }) {
  // alt задан на каждом теге, а не разложен из объекта: правило доступности
  // его через спред не видит, а отключать правило ради краткости не стоит.
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

/** Раздел навигации. `href` — путь внутри локали, пустой у корневого. */
export type NavItem = {
  href: string
  label: string
  icon: IconName
}

type IconName = 'overview' | 'approvals' | 'denials' | 'articles' | 'health'

/*
 * Иконки инлайном: пять штук на приложение не стоят зависимости, а
 * currentColor даёт им тему и активное состояние бесплатно.
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

/* ── Состояние «свёрнуто» ──────────────────────────────────────────────── */

/*
 * Ширину задаёт CSS-переменная на <html>, поэтому и состояние живёт там же:
 * иначе отступ содержимого пришлось бы синхронизировать отдельно. Атрибут
 * ставит сервер по cookie — см. src/lib/ui-state.ts, почему не localStorage.
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

/* ── Навигация ─────────────────────────────────────────────────────────── */

export type NavLabels = {
  /** Доступное имя всей навигации. */
  title: string
  collapse: string
  expand: string
}

/**
 * Навигация. Клиентский компонент только ради подсветки активного раздела
 * и состояния «свёрнуто» — сами ссылки обычные и работают без JS.
 *
 * На мобильном это закреплённая снизу панель: большой палец достаёт до
 * низа экрана, а не до шапки. С `sm:` она превращается в боковое меню
 * у левого края, которое сворачивается в одни иконки.
 *
 * Список разделов приходит извне: перечислять их здесь значило бы вести
 * ссылки на страницы, которых ещё нет.
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

  // Один раздел — показывать «переключатель» из одной вкладки нечестно.
  if (items.length < 2) return null

  return (
    <nav
      aria-label={labels.title}
      className={
        'fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface ' +
        'pb-[env(safe-area-inset-bottom,0px)] ' +
        // На десктопе — колонка во всю высоту у самого края экрана.
        'sm:inset-x-auto sm:top-0 sm:left-0 sm:h-dvh sm:w-[var(--nav-w)] ' +
        'sm:flex sm:flex-col sm:border-t-0 sm:border-r sm:pb-0'
      }
    >
      {/* Кнопка сворачивания — наверху панели и только на десктопе:
          снизу на телефоне панель и так состоит из одних иконок. */}
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
            {/* Панель со стрелкой: направление показывает, куда уедет меню. */}
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
            // min-w-0 обязателен: у flex-элемента min-width по умолчанию
            // auto, поэтому длинная подпись не даёт вкладке сжаться и
            // распирает панель за пределы экрана.
            //
            // «Состояние» на телефоне скрыто: раздел служебный, а пятое
            // место в нижней панели занимает знак студии. На десктопе
            // раздел остаётся в боковом меню.
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
                // Подсказка нужна только свёрнутому меню: там подпись скрыта.
                title={collapsed ? item.label : undefined}
                className={
                  // 56px по высоте — минимальная комфортная цель для пальца.
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

        {/* Знак студии на месте пятой вкладки — только на телефоне:
            на десктопе он стоит внизу боковой панели. */}
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
        Подпись студии — внизу боковой панели и только на десктопе: в нижней
        панели на телефоне места нет, там ссылка остаётся в подвале страницы.
        Свёрнутое меню показывает один знак, подпись уходит в подсказку.
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
