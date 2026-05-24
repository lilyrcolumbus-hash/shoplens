// Etsy client — handles token storage, refresh, and order fetching.

const STORAGE_KEY = 'shoplens_etsy_tokens'
const WORKER_URL = 'https://shoplens-push.lilyrcolumbus.workers.dev'

export interface EtsyTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface Order {
  id: string
  store: 'etsy' | 'amazon' | 'tiktok'
  product: string
  buyer: string
  amount: number
  currency: string
  status: 'unshipped' | 'shipped' | 'completed' | 'canceled'
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

// --- Listings (via the worker, which holds the Etsy refresh token) ---

export interface EtsyListing {
  id: number
  title: string
  state: string
  quantity: number
  price: number
  currency: string
  views: number
  numFavorers: number
  url: string
}

export interface EtsyListingsData {
  listings: EtsyListing[]
  counts: Record<string, number>
  updatedAt: number
}

export async function fetchEtsyListings(): Promise<EtsyListingsData> {
  const resp = await fetch(`${WORKER_URL}/etsy/listings`)
  if (!resp.ok) throw new Error(`Etsy listings failed: ${resp.status}`)
  return (await resp.json()) as EtsyListingsData
}

// --- PKCE helpers (client-side, robust on iOS Safari — no cookies) ---

const PKCE_KEY = 'shoplens_etsy_pkce'

function base64UrlEncode(bytes: Uint8Array): string {
  let str = ''
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(input: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return new Uint8Array(buf)
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes).slice(0, length)
}

export async function connectEtsy() {
  const verifier = randomString(64)
  const challenge = base64UrlEncode(await sha256(verifier))
  const state = randomString(32)
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }))
  const params = new URLSearchParams({ code_challenge: challenge, state })
  window.location.href = `/api/etsy/connect?${params}`
}
