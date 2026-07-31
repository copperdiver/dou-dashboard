import { checkDouConnectivity } from '@/app/[locale]/health/actions'
import { BTN_OUTLINE } from '@/components/form-controls'
import type { Locale } from '@/i18n'
import { formatDateTime, formatDuration, formatNumber, formatPercent } from '@/lib/format'
import type { DouStatus } from '@/lib/queries/dou-status'

/**
 * Связь с источником.
 *
 * Показывает то, что конвейер знает из собственного трафика: когда
 * последний раз удалось снять дневной индекс, чем закончилась последняя
 * неудача, стоит ли пауза после 403 и сколько запросов израсходовано
 * за сутки. Отдельного пинга при отрисовке нет — он тратил бы бюджет
 * и мог бы разбудить WAF; разовая проверка запускается кнопкой.
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
  /*
   * Три состояния, а не два. «Недоступен» — когда стоит пауза после 403
   * или дни окончательно упали: тогда свежие выпуски не придут. «С
   * оговорками» — успех был, но последняя попытка закончилась ошибкой:
   * связь есть, но не устойчивая.
   */
  const blocked = status.cooldownMs > 0 || status.failedDays > 0
  const shaky = !blocked && status.lastFailure !== null
  // Классы перечислены целиком: Tailwind не видит имён, собранных из
  // кусков, и `text-${tone}` просто не попал бы в сборку.
  const tone = blocked ? 'text-critical' : shaky ? 'text-warning' : 'text-good'
  const verdict = blocked ? labels.unreachable : shaky ? labels.degraded : labels.reachable

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{labels.title}</h2>

        {/* Форма, а не кнопка с обработчиком: серверное действие работает
            без JS, и страница обновится сама. */}
        <form action={checkDouConnectivity}>
          <button type="submit" className={BTN_OUTLINE}>
            {labels.check}
          </button>
        </form>
      </div>

      <p className="mt-3 flex items-center gap-2 text-sm">
        {/* Иконка вместе с подписью: цвет один смысл не несёт. */}
        <span className={tone} aria-hidden="true">
          {blocked ? '✕' : shaky ? '!' : '✓'}
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
        {/* Без этой строки при отладке неясно, какой адрес видит источник. */}
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
