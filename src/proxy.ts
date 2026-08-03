import { NextResponse, type NextRequest } from 'next/server'
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from '@/i18n/config'

/**
 * Rewrites the path to `/<locale>/…`.
 *
 * The locale lives in the path, not a cookie: that way a page's address is
 * unambiguous and shareable together with its language. If the first
 * segment isn't a locale, redirect: otherwise the same page would have
 * two different addresses for the same content.
 */
export const config = {
  /*
   * Skip the proxy for: Next's internal routes, the API, and anything
   * with a dot in it (files under public, like favicon, robots.txt, images).
   * Otherwise a static-asset request would end up rewritten to
   * /ru/favicon.ico.
   */
  matcher: ['/((?!_next/|api/|.*\\.).*)'],
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const first = pathname.split('/')[1] ?? ''
  if (isLocale(first)) return NextResponse.next()

  const url = request.nextUrl.clone()
  const locale = preferredLocale(request.headers.get('accept-language'))
  // pathname always starts with a slash, and for the root it's just "/".
  url.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`

  return NextResponse.redirect(url)
}

/**
 * Language from Accept-Language, honoring q weights. Compared by base tag:
 * `en-GB` and `en-US` are both just `en` to us. If nothing matches, fall
 * back to Russian, since the dashboard's audience is Russian-speaking.
 */
function preferredLocale(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='))
        ?.slice(2)
      const weight = q === undefined ? 1 : Number(q)

      return {
        base: (tag ?? '').trim().toLowerCase().split('-')[0] ?? '',
        weight: Number.isFinite(weight) ? weight : 0,
      }
    })
    // A weight of 0 means "this language won't do", so drop those entries.
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)

  for (const entry of ranked) {
    if ((LOCALES as readonly string[]).includes(entry.base)) return entry.base as Locale
  }

  return DEFAULT_LOCALE
}
