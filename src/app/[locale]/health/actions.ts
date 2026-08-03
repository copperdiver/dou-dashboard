'use server'

import { revalidatePath } from 'next/cache'
import { probeDou } from '@/lib/dou/probe'

/**
 * Checks connectivity to the source on button click.
 *
 * A server action, not a browser request: the server must be the one
 * hitting in.gov.br: it has the User-Agent, rate interval, and daily
 * budget configured, and a request from the page would run into
 * cross-origin policy.
 *
 * The result is stored in Redis and read on the next render, so the page
 * refreshes via a plain `revalidatePath` and works without JS.
 */
export async function checkDouConnectivity(): Promise<void> {
  await probeDou()
  revalidatePath('/[locale]/health', 'page')
}
