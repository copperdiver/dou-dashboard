'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { LOCALE_LABELS, LOCALES, type Locale } from '@/i18n/config'
import { SEGMENT_GROUP, segmentClass } from '@/components/segmented'

/**
 * Language switcher.
 *
 * Plain links to the same path with a different locale: the language is
 * part of the URL, so the page can be shared along with the language, and
 * switching works without JS. The client component is only needed to know
 * the current path.
 *
 * Query params are carried over: otherwise switching language on a
 * filtered feed would reset the filters and the period.
 *
 * The segment shows the language code, not a flag: a flag denotes a
 * country, not a language, and English would have to be pinned to one
 * arbitrarily. The full self-name stays available as the link's accessible name.
 */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // The first segment is the locale; the rest of the path is the current page.
  const rest = pathname.split('/').slice(2).join('/')
  const query = searchParams.toString()

  return (
    <div className={SEGMENT_GROUP} role="group" aria-label={label}>
      {LOCALES.map((value) => {
        const active = value === locale
        const href = `/${value}${rest ? `/${rest}` : ''}${query ? `?${query}` : ''}`

        return (
          <Link
            key={value}
            href={href}
            hrefLang={value}
            aria-current={active ? 'true' : undefined}
            title={LOCALE_LABELS[value]}
            className={segmentClass(active)}
          >
            <span aria-hidden="true">{value.toUpperCase()}</span>
            <span className="sr-only">{LOCALE_LABELS[value]}</span>
          </Link>
        )
      })}
    </div>
  )
}
