'use server'

import { revalidatePath } from 'next/cache'
import { probeDou } from '@/lib/dou/probe'

/**
 * Проверка связи с источником по нажатию.
 *
 * Серверное действие, а не запрос из браузера: ходить в in.gov.br должен
 * сервер — у него настроен User-Agent, интервал и суточный бюджет,
 * а запрос со страницы упёрся бы в политику разных источников.
 *
 * Результат кладётся в Redis и читается при следующей отрисовке, поэтому
 * страница обновляется обычным `revalidatePath` и работает без JS.
 */
export async function checkDouConnectivity(): Promise<void> {
  await probeDou()
  revalidatePath('/[locale]/health', 'page')
}
