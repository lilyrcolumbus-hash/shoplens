// Amazon orders client — reads the worker's cached Amazon orders.
import type { Order } from './etsy'

const WORKER_URL = 'https://shoplens-push.lilyrcolumbus.workers.dev'

export async function fetchAmazonOrders(): Promise<Order[]> {
  const resp = await fetch(`${WORKER_URL}/amazon/orders`)
  if (!resp.ok) throw new Error(`Amazon fetch failed: ${resp.status}`)
  return (await resp.json()) as Order[]
}
