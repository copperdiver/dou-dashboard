/**
 * Country flag.
 *
 * Vector flags from `flag-icons`, not emoji: emoji flags are rendered by
 * the platform, and Windows draws the country-code letters instead: in
 * lists this produced things like "во Боливия", "нт Гаити", which reads
 * like a typo, not a flag.
 *
 * The flag is decoration and a visual anchor: the country name next to it
 * carries the meaning. So it's hidden from screen readers: announcing
 * "flag of Haiti" right before the word "Haiti" would just be repeating itself.
 */
export function Flag({ iso2, className = '' }: { iso2: string | null; className?: string }) {
  if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) return null

  return (
    <span
      // The 4:3 ratio is set by the package itself; we only fix the height
      // so the flag sits on the line next to the text.
      className={`fi fi-${iso2.toLowerCase()} inline-block h-3 w-4 shrink-0 rounded-[2px] align-[-1px] ${className}`}
      aria-hidden="true"
    />
  )
}
