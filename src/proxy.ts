import { NextResponse, type NextRequest } from 'next/server'
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from '@/i18n/config'

/**
 * Приводит адрес к виду `/<локаль>/…`.
 *
 * Локаль живёт в пути, а не в cookie: адрес страницы тогда однозначен и
 * делится ссылкой вместе с языком. Без локали в первом сегменте —
 * редирект, чтобы у страницы не было двух адресов с одним содержимым.
 */
export const config = {
  /*
   * Мимо прокси: внутренние маршруты Next, API и всё, в чём есть точка
   * (файлы из public — favicon, robots.txt, картинки). Иначе запрос
   * статики уехал бы на /ru/favicon.ico.
   */
  matcher: ['/((?!_next/|api/|.*\\.).*)'],
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const first = pathname.split('/')[1] ?? ''
  if (isLocale(first)) return NextResponse.next()

  const url = request.nextUrl.clone()
  const locale = preferredLocale(request.headers.get('accept-language'))
  // pathname всегда начинается со слэша, а для корня он и есть «/».
  url.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`

  return NextResponse.redirect(url)
}

/**
 * Язык из Accept-Language с учётом весов q. Сравнение по базовому тегу:
 * `en-GB` и `en-US` для нас одинаково `en`. Ничего не подошло — русский,
 * потому что аудитория дашборда русскоязычная.
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
    // Вес 0 означает «этот язык не годится» — такие варианты отбрасываем.
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)

  for (const entry of ranked) {
    if ((LOCALES as readonly string[]).includes(entry.base)) return entry.base as Locale
  }

  return DEFAULT_LOCALE
}
