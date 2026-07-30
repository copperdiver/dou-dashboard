import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { SiteNav, type NavItem } from '@/components/site-nav'
import { isNavCollapsed, NAV_COOKIE, parseTheme, THEME_COOKIE } from '@/lib/ui-state'
import { getDictionary, isLocale, LOCALES } from '@/i18n'
import '../globals.css'
// Флаги стран. Глобальный CSS допускается только в корневом layout,
// а корневой здесь именно этот.
import 'flag-icons/css/flag-icons.min.css'

/*
 * Это корневой layout приложения: `src/app/layout.tsx` намеренно
 * отсутствует. Тег <html> должен получить атрибут lang текущей локали,
 * а корневой layout вне сегмента [locale] её не знает.
 */

/** Заранее известный список локалей — по нему Next строит маршруты. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

/*
 * Канонический адрес и hreflang выводятся только при заданном
 * NEXT_PUBLIC_SITE_URL: иначе Next подставил бы localhost, а неверный
 * hreflang хуже отсутствующего.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  // Заголовок для неизвестной локали не нужен — страница станет 404.
  if (!isLocale(locale)) return {}

  const d = getDictionary(locale)

  return {
    title: d.common.appName,
    description: d.common.subtitle,
    ...(SITE_URL
      ? {
          metadataBase: new URL(SITE_URL),
          alternates: {
            canonical: `/${locale}`,
            languages: Object.fromEntries(LOCALES.map((value) => [value, `/${value}`])),
          },
        }
      : {}),
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  // Неизвестная локаль — 404, а не тихий откат на язык по умолчанию:
  // иначе опечатка в URL отдавала бы страницу с чужим языком.
  if (!isLocale(locale)) notFound()

  const d = getDictionary(locale)

  // Оформление приходит cookie и попадает прямо в разметку: так атрибутами
  // владеет React, и клиентская навигация их не снимает.
  const jar = await cookies()
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value)
  const navCollapsed = isNavCollapsed(jar.get(NAV_COOKIE)?.value)

  const navItems: NavItem[] = [
    { href: '', label: d.nav.dashboard, icon: 'overview' },
    { href: '/approvals', label: d.nav.approvals, icon: 'approvals' },
    { href: '/denials', label: d.nav.denials, icon: 'denials' },
    { href: '/articles', label: d.nav.articles, icon: 'articles' },
    { href: '/health', label: d.nav.health, icon: 'health' },
  ]

  return (
    <html
      lang={locale}
      data-theme={theme === 'system' ? undefined : theme}
      data-nav={navCollapsed ? 'collapsed' : undefined}
      suppressHydrationWarning
    >
      <head />
      <body className="min-h-dvh antialiased">
        <SiteNav
          locale={locale}
          items={navItems}
          labels={{ title: d.nav.title, collapse: d.nav.collapse, expand: d.nav.expand }}
        />

        {/*
          Меню вынуто из потока в обеих раскладках, поэтому содержимое
          отступает от него само: снизу — на высоту панели с безопасной
          зоной, слева на десктопе — на ширину колонки. Ширина приходит
          переменной, так что отступ следует за сворачиванием меню.
        */}
        <div className="sm:pl-[var(--nav-w)]">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
                  {d.common.appName}
                </h1>
                <p className="mt-1 text-xs text-ink-secondary">{d.common.subtitle}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <LanguageSwitcher locale={locale} label={d.common.language} />
                <ThemeToggle label={d.common.theme} labels={d.theme} />
              </div>
            </header>

            {/* Подвала нет: подпись студии живёт в самой навигации —
                внизу боковой панели на десктопе и пятой вкладкой снизу
                на телефоне. Отступ под закреплённую панель остаётся. */}
            <main className="mt-5 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom,0px)+1rem)] sm:pb-8">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  )
}
