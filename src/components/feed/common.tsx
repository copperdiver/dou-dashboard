/** Small bits shared across all feeds. */

export function SourceLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-block text-xs font-medium text-series-1 hover:underline"
    >
      {label} ↗
    </a>
  )
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-xs text-ink-secondary">{hint}</p>
    </div>
  )
}

/**
 * Mark on a denial record: upholding a prior decision, republication, or
 * termination. Needed so a reader doesn't mistake an upheld appeal for a
 * new denial; they aren't mixed together in the counters either.
 */
export function DecisionBadge({ label, slot }: { label: string; slot: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2 py-0.5 text-[11px] text-ink-secondary">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--series-${slot})` }}
        aria-hidden="true"
      />
      {label}
    </span>
  )
}
