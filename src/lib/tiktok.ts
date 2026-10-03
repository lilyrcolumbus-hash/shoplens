// TikTok Shop client — reads the worker's cached TikTok orders/listings, and kicks off
// the OAuth connect flow. Mirrors lib/amazon.ts. The worker holds the refresh token +
// shop_cipher and signs every TikTok API request (HMAC-SHA256); the app never sees secrets.
import type { Order } from './etsy'
import { WORKER_URL, workerFetch } from './worker'


// Redirect the seller to TikTok's authorization screen (Pages Function builds the URL).
export function connectTiktok(): void {
  window.location.href = '/api/tiktok/connect'
}

// Forgets this shop's TikTok authorization (keeps the saved app key/secret in Settings).
export async function disconnectTiktok(): Promise<void> {
  const resp = await workerFetch(`${WORKER_URL}/tiktok/session`, { method: 'DELETE' })
  if (!resp.ok) throw new Error(`Could not disconnect — HTTP ${resp.status}`)
}

export async function fetchTiktokOrders(): Promise<Order[]> {
  const resp = await workerFetch(`${WORKER_URL}/tiktok/orders`)
  if (!resp.ok) throw new Error(`TikTok fetch failed: ${resp.status}`)
  return (await resp.json()) as Order[]
}

export interface TiktokListing {
  id: string
  title: string
  status: string
  quantity: number
  price: number
  currency: string
  url: string
}

export async function fetchTiktokListings(): Promise<TiktokListing[] | 'pending'> {
  const resp = await workerFetch(`${WORKER_URL}/tiktok/listings`)
  if (!resp.ok) throw new Error(`TikTok listings fetch failed: ${resp.status}`)
  const j = (await resp.json()) as { status?: string; listings?: TiktokListing[] }
  if (j.status === 'pending') return 'pending'
  return j.listings ?? []
}
