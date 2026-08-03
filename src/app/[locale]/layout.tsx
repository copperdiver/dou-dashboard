import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { Clarity } from '@/components/clarity'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { SiteNav, type NavItem } from '@/components/site-nav'
import { isNavCollapsed, NAV_COOKIE, parseTheme, THEME_COOKIE } from '@/lib/ui-state'
import { getDictionary, isLocale, LOCALES } from '@/i18n'
import '../globals.css'
// Country flags. Global CSS is only allowed in the root layout,
// and this is that root layout.
import 'flag-icons/css/flag-icons.min.css'

/*
 * This is the app's root layout: `src/app/layout.tsx` is intentionally
 * absent. The <html> tag needs the current locale's lang attribute, and a
 * root layout outside the [locale] segment wouldn't know it.
 */

/** Locale list known in advance: Next builds routes from it. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

/*
 * The canonical URL and hreflang are only emitted when SITE_URL is set:
 * otherwise Next would fall back to localhost, and a wrong hreflang is
 * worse than none.
 *
 * The name has no NEXT_PUBLIC_ prefix on purpose. Such variables are
 * inlined by Next at build time, which would make it impossible to set
 * them via compose on the server. The value is only read by the server-side
 * `generateMetadata`, so it stays a regular environment variable and can
 * change without rebuilding the image.
 */
const SITE_URL = process.env.SITE_URL

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  // No title needed for an unknown locale: the page will 404 anyway.
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
  // Unknown locale is a 404, not a silent fallback to the default language:
  // otherwise a typo in the URL would serve a page in the wrong language.
  if (!isLocale(locale)) notFound()

  const d = getDictionary(locale)

  // Appearance comes from a cookie and lands directly in the markup: this way
  // React owns the attributes, and client-side navigation doesn't strip them.
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
        {/* The counter lives in the root layout, so it lands on every page
            and survives client-side navigation between them. */}
        <Clarity id={process.env.CLARITY_ID} />

        <SiteNav
          locale={locale}
          items={navItems}
          labels={{ title: d.nav.title, collapse: d.nav.collapse, expand: d.nav.expand }}
        />

        {/*
          The menu is taken out of flow in both layouts, so content pads for
          it on its own: at the bottom by the panel's height plus the safe
          area, on the left on desktop by the column's width. The width comes
          from a CSS variable, so the padding follows the menu's collapse state.
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

            {/* There's no footer: the studio credit lives inside the nav itself,
                at the bottom of the sidebar on desktop and as a fifth tab
                on mobile. Padding for the fixed panel stays either way. */}
            <main className="mt-5 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom,0px)+1rem)] sm:pb-8">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  )
}
