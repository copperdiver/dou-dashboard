import { DouClient, dailyIndexUrl } from './client'
import { douConfig } from '../env'
import { getRedis, saveProbe, type DouProbe } from '../queries/dou-status'

/**
 * Разовая проверка связи с источником — по требованию, а не по таймеру.
 *
 * Идёт через обычный `DouClient`, а не через голый fetch: так проверка
 * подчиняется тем же правилам, что и насосы — минимальному интервалу,
 * суточному бюджету и паузе после 403. Проверка, которая ходит в обход
 * этих правил, могла бы сама навлечь блокировку, ради диагностики
 * которой её и запускают.
 *
 * Запрашивается дневной индекс за сегодня — тот самый адрес, на котором
 * спотыкается `enumerate`, а не корень сайта: корень может отвечать,
 * когда нужный раздел уже закрыт.
 */
export async function probeDou(): Promise<DouProbe> {
  const redis = await getRedis()
  const at = new Date().toISOString()

  if (!redis) {
    return { at, ok: false, status: null, message: 'REDIS_URL не задан', durationMs: 0 }
  }

  const cfg = douConfig()
  const today = new Date().toISOString().slice(0, 10)
  // Секций может быть несколько; для проверки связи хватит первой.
  const section = cfg.sections[0] ?? 'do1'

  const client = new DouClient(redis)
  const started = Date.now()

  const cooldown = await client.cooldownRemainingMs()
  if (cooldown > 0) {
    const probe: DouProbe = {
      at,
      ok: false,
      status: null,
      message: `источник на паузе после 403, осталось ${Math.ceil(cooldown / 1000)} с`,
      durationMs: 0,
    }
    await saveProbe(probe)
    return probe
  }

  const response = await client.get(dailyIndexUrl(today, section))
  const durationMs = Date.now() - started

  const probe: DouProbe = { at, durationMs, ...describe(response) }
  await saveProbe(probe)
  return probe
}

function describe(
  response: Awaited<ReturnType<DouClient['get']>>,
): { ok: boolean; status: number | null; message: string } {
  switch (response.kind) {
    case 'ok':
      return { ok: true, status: response.status, message: `HTTP ${response.status}` }
    case 'gone':
      return { ok: false, status: response.status, message: `HTTP ${response.status}: выпуск снят` }
    case 'forbidden':
      return {
        ok: false,
        status: response.status,
        message: `HTTP ${response.status}: источник закрыл доступ, пауза ${Math.round(
          response.cooldownMs / 1000,
        )} с`,
      }
    case 'budget_exhausted':
      return {
        ok: false,
        status: null,
        message: `исчерпан суточный бюджет запросов (${response.used} из ${response.limit})`,
      }
    case 'transient':
      return { ok: false, status: response.status, message: response.message }
  }
}
