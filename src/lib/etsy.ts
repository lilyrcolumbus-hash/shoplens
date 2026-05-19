// Etsy client — handles token storage, refresh, and order fetching.

const STORAGE_KEY = 'shoplens_etsy_tokens'

export interface EtsyTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface Order {
  id: string
  store: 'etsy' | 'amazon' | 'tiktok' | 'whatnot' | 'shopify' | 'ebay'
  product: string
  buyer: string
  amount: number
  currency: string
  status: 'new' | 'shipped' | 'delivered'
  createdAt: string
}

export function loadTokens(): EtsyTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as EtsyTokens
  } catch {
    return null
  }
}

export function saveTokens(tokens: EtsyTokens) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
}

export function clearTokens() {
  localStorage.removeItem(STORAGE_KEY)
}

export function isConnected(): boolean {
  return loadTokens() !== null
}

async function refreshTokens(refreshToken: string): Promise<EtsyTokens> {
  const resp = await fetch('/api/etsy/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!resp.ok) {
    throw new Error(`Refresh failed: ${resp.status}`)
  }
  const tokens = await resp.json() as EtsyTokens
  saveTokens(tokens)
  return tokens
}

async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens()
  if (!tokens) throw new Error('not_connected')

  // Refresh if expiring within 60 seconds
  if (tokens.expiresAt < Date.now() + 60_000) {
    const refreshed = await refreshTokens(tokens.refreshToken)
    return refreshed.accessToken
  }
  return tokens.accessToken
}

export async function fetchEtsyOrders(): Promise<Order[]> {
  const accessToken = await getValidAccessToken()
  const resp = await fetch('/api/etsy/orders', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (resp.status === 401) {
    // Token expired despite our check — try refresh once
    const tokens = loadTokens()
    if (tokens) {
      const refreshed = await refreshTokens(tokens.refreshToken)
      const retry = await fetch('/api/etsy/orders', {
        headers: { Authorization: `Bearer ${refreshed.accessToken}` },
      })
      if (!retry.ok) throw new Error(`Etsy fetch failed after refresh: ${retry.status}`)
      const data = await retry.json() as { orders: Order[] }
      return data.orders
    }
    throw new Error('token_expired')
  }

  if (!resp.ok) {
    throw new Error(`Etsy fetch failed: ${resp.status}`)
  }
  const data = await resp.json() as { orders: Order[] }
  return data.orders
}

export function connectEtsy() {
  window.location.href = '/api/etsy/connect'
}
