// Client for the worker's /config endpoint — lets anyone running their own copy of
// ShopLens plug in their own Etsy/Amazon/TikTok app credentials from Settings, instead
// of a developer hardcoding one person's accounts at deploy time.
const WORKER_URL = 'https://shoplens-push.lilyrcolumbus.workers.dev'

export interface ConnectionsStatus {
  etsy: { configured: boolean; shopId: string }
  amazon: { configured: boolean; marketplaces: string }
  tiktok: { configured: boolean }
}

export async function fetchConnectionsStatus(): Promise<ConnectionsStatus> {
  const resp = await fetch(`${WORKER_URL}/config`)
  if (!resp.ok) throw new Error(`Could not load connection status (HTTP ${resp.status})`)
  return (await resp.json()) as ConnectionsStatus
}

export async function saveConnection(
  provider: 'etsy' | 'amazon' | 'tiktok',
  fields: Record<string, string>,
): Promise<ConnectionsStatus> {
  const resp = await fetch(`${WORKER_URL}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, fields }),
  })
  if (!resp.ok) throw new Error(`Could not save — HTTP ${resp.status}`)
  const data = (await resp.json()) as { status: ConnectionsStatus }
  return data.status
}

export async function clearConnection(provider: 'etsy' | 'amazon' | 'tiktok'): Promise<void> {
  const resp = await fetch(`${WORKER_URL}/config?provider=${provider}`, { method: 'DELETE' })
  if (!resp.ok) throw new Error(`Could not clear — HTTP ${resp.status}`)
}
