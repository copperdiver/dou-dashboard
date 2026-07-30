'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { LOCALE_LABELS, LOCALES, type Locale } from '@/i18n/config'
import { SEGMENT_GROUP, segmentClass } from '@/components/segmented'

/**
 * Переключатель языка.
 *
 * Обычные ссылки на тот же путь с другой локалью: язык — часть адреса,
 * поэтому страница пересылается вместе с языком, а переключение работает
 * без JS. Клиентский компонент нужен только чтобы узнать текущий путь.
 *
 * Параметры запроса переносятся: иначе смена языка на отфильтрованном
 * фиде сбрасывала бы фильтры и период.
 *
 * На сегменте код языка, а не флаг: флаг обозначает страну, а не язык,
 * и английский пришлось бы приписать какой-то одной из них. Полное
 * самоназвание остаётся доступным именем ссылки.
 */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Первый сегмент — локаль; остальной путь и есть текущая страница.
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
