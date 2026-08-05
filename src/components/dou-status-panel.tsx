import { checkDouConnectivity } from '@/app/[locale]/health/actions'
import { BTN_OUTLINE } from '@/components/form-controls'
import type { Locale } from '@/i18n'
import { sourceVerdict } from '@/lib/dou/verdict'
import { formatDateTime, formatDuration, formatNumber, formatPercent } from '@/lib/format'
import type { DouStatus } from '@/lib/queries/dou-status'

/**
 * Source connectivity.
 *
 * Shows what the pipeline knows from its own traffic: when the daily index
 * was last fetched successfully, how the last failure ended, whether a
 * cooldown after a 403 is in effect, and how much of the daily request
 * budget has been used. There's no dedicated ping on render: it would
 * burn budget and could wake up the WAF; a one-off check is triggered by
 * the button instead.
 *
 * Because the verdict is read at a glance and acted on, it must not stay
 * red once the thing it warned about is over: an alarm that never clears
 * stops being read at all.
 */

export type StatusLabels = {
  title: string
  reachable: string
  unreachable: string
  degraded: string
  lastSuccess: string
  lastFailure: string
  cooldown: string
  budget: string
  failedDays: string
  pendingPages: string
  check: string
  probeNever: string
  probeAt: string
  redisDown: string
  never: string
  proxyOn: string
  proxyOff: string
}

export function DouStatusPanel({
  locale,
  status,
  labels,
}: {
  locale: Locale
  status: DouStatus
  labels: StatusLabels
}) {
  // Three states, and the rule behind them lives in `sourceVerdict`: it
  // is the part that has to stay honest, so it is tested separately.
  const state = sourceVerdict(status)
  // Classes are spelled out in full: Tailwind can't see names assembled
  // from pieces, so `text-${tone}` simply wouldn't make it into the build.
  const tone =
    state === 'blocked' ? 'text-critical' : state === 'degraded' ? 'text-warning' : 'text-good'
  const verdict =
    state === 'blocked'
      ? labels.unreachable
      : state === 'degraded'
        ? labels.degraded
        : labels.reachable

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{labels.title}</h2>

        {/* A form, not a button with a handler: the server action works
            without JS, and the page refreshes on its own. */}
        <form action={checkDouConnectivity}>
          <button type="submit" className={BTN_OUTLINE}>
            {labels.check}
          </button>
        </form>
      </div>

      <p className="mt-3 flex items-center gap-2 text-sm">
        {/* Icon paired with a label: color alone doesn't carry the meaning. */}
        <span className={tone} aria-hidden="true">
          {state === 'blocked' ? '✕' : state === 'degraded' ? '!' : '✓'}
        </span>
        <span className="font-medium text-ink">{verdict}</span>
      </p>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        <Row
          label={labels.lastSuccess}
          value={
            status.lastSuccessAt ? formatDateTime(locale, status.lastSuccessAt) : labels.never
          }
        />
        <Row
          label={labels.budget}
          value={`${formatNumber(locale, status.budget.used)} / ${formatNumber(
            locale,
            status.budget.limit,
          )}${
            status.budget.limit > 0
              ? ` · ${formatPercent(locale, status.budget.used / status.budget.limit, 0)}`
              : ''
          }`}
        />
        {status.cooldownMs > 0 && (
          <Row label={labels.cooldown} value={formatDuration(locale, status.cooldownMs)} />
        )}
        {status.failedDays > 0 && (
          <Row label={labels.failedDays} value={formatNumber(locale, status.failedDays)} />
        )}
        <Row label={labels.pendingPages} value={formatNumber(locale, status.pendingPages)} />
        {/* Without this row, it's unclear during debugging which address the source sees. */}
        <Row label={labels.proxyOn} value={status.viaProxy ? '✓' : labels.proxyOff} />
        {!status.redisAvailable && <Row label={labels.redisDown} value="—" />}
      </dl>

      {status.lastFailure && (
        <p className="mt-3 text-xs text-ink-muted">
          {labels.lastFailure}{' '}
          <span className="text-ink-secondary">
            {status.lastFailure.day} · {status.lastFailure.error}
          </span>
        </p>
      )}

      <p className="mt-2 text-xs text-ink-muted">
        {status.probe
          ? `${labels.probeAt} ${formatDateTime(locale, status.probe.at)} · ${
              status.probe.message
            } · ${formatDuration(locale, status.probe.durationMs)}`
          : labels.probeNever}
      </p>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  )
}
