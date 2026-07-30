/**
 * Состояние оформления, которое обязан знать сервер: тема и свёрнутость
 * меню.
 *
 * Хранится в cookie, а не в localStorage, по одной причине: атрибуты
 * `data-theme` и `data-nav` висят на <html>. Если их проставляет скрипт,
 * React о них не знает — и при первой же клиентской навигации, меняющей
 * корневой сегмент (например, переключении языка), он перерисовывает
 * <html> и снимает «лишние» атрибуты. Тема молча сбрасывалась на
 * системную. Cookie приходит с запросом, поэтому атрибут ставится прямо
 * в разметке: React им владеет, снимать нечего, и мигания при первой
 * отрисовке тоже нет.
 */

export const THEME_COOKIE = 'dou-theme'
export const NAV_COOKIE = 'dou-nav'

/** Год: выбор оформления не должен слетать между визитами. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export type Theme = 'light' | 'dark' | 'system'

export function parseTheme(value: string | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function isNavCollapsed(value: string | undefined): boolean {
  return value === 'collapsed'
}

/**
 * Записывает cookie и сразу правит атрибут на <html>.
 *
 * Атрибут правится вручную ради мгновенного отклика: ждать ответа
 * сервера, чтобы перекрасить страницу по нажатию, недопустимо.
 */
export function writeUiCookie(name: string, value: string | null): void {
  try {
    document.cookie =
      value === null
        ? `${name}=; path=/; max-age=0; samesite=lax`
        : `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
  } catch {
    // приватный режим — выбор просто не запомнится
  }
}
