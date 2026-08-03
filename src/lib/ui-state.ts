/**
 * Presentation state the server must know about: theme and whether the
 * nav menu is collapsed.
 *
 * Stored in a cookie rather than localStorage for one reason: the
 * `data-theme` and `data-nav` attributes live on <html>. If a script
 * sets them, React doesn't know about them, and on the very first
 * client-side navigation that changes the root segment (e.g. switching
 * language), React re-renders <html> and strips the "extra" attributes.
 * The theme would silently reset to system. A cookie arrives with the
 * request, so the attribute is set right in the markup: React owns it,
 * there's nothing to strip, and there's no flash on first paint either.
 */

export const THEME_COOKIE = 'dou-theme'
export const NAV_COOKIE = 'dou-nav'

/** A year: the appearance choice shouldn't reset between visits. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export type Theme = 'light' | 'dark' | 'system'

export function parseTheme(value: string | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function isNavCollapsed(value: string | undefined): boolean {
  return value === 'collapsed'
}

/**
 * Writes the cookie and immediately patches the attribute on <html>.
 *
 * The attribute is patched by hand for an instant response: waiting for
 * a server round trip to repaint the page on a click is unacceptable.
 */
export function writeUiCookie(name: string, value: string | null): void {
  try {
    document.cookie =
      value === null
        ? `${name}=; path=/; max-age=0; samesite=lax`
        : `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
  } catch {
    // private browsing mode: the choice just won't be remembered
  }
}
