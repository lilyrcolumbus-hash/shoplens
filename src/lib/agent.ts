// ShopLens AI advisor client. Builds a compact snapshot of the user's REAL data and sends it
// (with the chat history) to the /api/agent Pages Function, which calls Claude server-side.
import type { Order } from './etsy'
import { ownerHeaders } from './worker'
import type { AmazonTraffic, AmazonListing } from './amazon'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

type Store = Order['store']

// Compact, grounded summary — never raw dumps. This is the agent's single source of truth.
export interface AgentContext {
  generatedAt: string
  stores: Array<{
    store: Store
    connected: boolean
    orders: number
    unshipped: number
    daysSinceLastSale: number | null
    revenueByCurrency: Record<string, number>
  }>
  amazonTraffic?: {
    rangeDays: number
    sessions: number
    pageViews: number
    conversionPct: number
    buyBoxPct: number
  }
  amazonListings?: { total: number; active: number; outOfStock: number; lowTraffic: number }
}

function summarizeStore(store: Store, orders: Order[], connected: boolean) {
  const active = orders.filter(o => o.status !== 'canceled')
  const revenueByCurrency: Record<string, number> = {}
  for (const o of active) {
    const c = o.currency || 'USD'
    revenueByCurrency[c] = (revenueByCurrency[c] ?? 0) + o.amount
  }
  const ts = active.map(o => +new Date(o.createdAt)).filter(n => !isNaN(n))
  const daysSinceLastSale = ts.length ? Math.floor((Date.now() - Math.max(...ts)) / 86400000) : null
  return {
    store,
    connected,
    orders: active.length,
    unshipped: active.filter(o => o.status === 'unshipped').length,
    daysSinceLastSale,
    revenueByCurrency: Object.fromEntries(Object.entries(revenueByCurrency).map(([k, v]) => [k, Math.round(v * 100) / 100])),
  }
}

export function buildAgentContext(params: {
  ordersByStore: Partial<Record<Store, Order[]>>
  connectedByStore: Partial<Record<Store, boolean>>
  amazonTraffic?: AmazonTraffic | 'pending' | null
  amazonListings?: AmazonListing[] | null
}): AgentContext {
  const stores: AgentContext['stores'] = (['etsy', 'amazon', 'tiktok'] as Store[]).map(s =>
    summarizeStore(s, params.ordersByStore[s] ?? [], Boolean(params.connectedByStore[s])),
  )

  const ctx: AgentContext = { generatedAt: new Date().toISOString(), stores }

  if (params.amazonTraffic && params.amazonTraffic !== 'pending') {
    const t = params.amazonTraffic.totals
    ctx.amazonTraffic = {
      rangeDays: params.amazonTraffic.rangeDays,
      sessions: t.sessions,
      pageViews: t.pageViews,
      conversionPct: Math.round(t.conversionPct * 10) / 10,
      buyBoxPct: Math.round(t.buyBoxPct),
    }
  }

  if (params.amazonListings && params.amazonListings.length) {
    const l = params.amazonListings
    ctx.amazonListings = {
      total: l.length,
      active: l.filter(x => (x.status || '').toLowerCase() === 'active').length,
      outOfStock: l.filter(x => x.quantity === 0).length,
      lowTraffic: l.filter(x => (x.sessions ?? 0) < 3).length,
    }
  }

  return ctx
}

export async function askAgent(messages: ChatMessage[], context: AgentContext): Promise<string> {
  const resp = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
    body: JSON.stringify({ messages, context }),
  })
  const data = (await resp.json()) as { text?: string; error?: string }
  if (!resp.ok || !data.text) {
    throw new Error(data.error ?? `El asesor falló (HTTP ${resp.status})`)
  }
  return data.text
}
