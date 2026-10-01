// ShopLens push worker.
// - fetch handler: POST /subscribe (store push subscription + Etsy refresh token),
//   POST /test (send a test push)
// - scheduled handler (cron): poll Etsy receipts, push on new orders.

import { buildPushPayload } from '@block65/webcrypto-web-push'

// Env vars/secrets below are an optional fallback only — this worker can run with none of
// them set. The real, user-facing source of store credentials is the KV-backed config (see
// getConfig/saveConfig): anyone deploying their own copy of ShopLens enters their own Etsy/
// Amazon/TikTok app credentials from the app's Settings screen instead of a developer having
// to hardcode them at deploy time. Env vars only exist so an existing deployment (already
// configured the old way) keeps working until it's migrated.
interface Env {
  PUSH_KV: KVNamespace
  VAPID_PUBLIC: string
  VAPID_PRIVATE: string
  VAPID_SUBJECT: string
  ETSY_KEYSTRING?: string
  ETSY_SHARED_SECRET?: string
  ETSY_SHOP_ID?: string
  AMAZON_CLIENT_ID?: string
  AMAZON_CLIENT_SECRET?: string
  AMAZON_REFRESH_TOKEN?: string
  AMAZON_MARKETPLACES?: string
  TIKTOK_APP_KEY?: string
  TIKTOK_APP_SECRET?: string
}

// ── User-configurable store connections (KV-backed, no redeploy needed) ──
interface StoreConfig {
  etsy: { keystring: string; sharedSecret: string; shopId: string }
  amazon: { clientId: string; clientSecret: string; refreshToken: string; marketplaces: string }
  tiktok: { appKey: string; appSecret: string; serviceId: string }
}

async function getConfig(env: Env): Promise<StoreConfig> {
  const raw = await env.PUSH_KV.get('config')
  const stored = raw ? (JSON.parse(raw) as Partial<StoreConfig>) : {}
  // Env vars are only a fallback for fields the stored config hasn't set yet.
  return {
    etsy: {
      keystring: stored.etsy?.keystring || env.ETSY_KEYSTRING || '',
      sharedSecret: stored.etsy?.sharedSecret || env.ETSY_SHARED_SECRET || '',
      shopId: stored.etsy?.shopId || env.ETSY_SHOP_ID || '',
    },
    amazon: {
      clientId: stored.amazon?.clientId || env.AMAZON_CLIENT_ID || '',
      clientSecret: stored.amazon?.clientSecret || env.AMAZON_CLIENT_SECRET || '',
      refreshToken: stored.amazon?.refreshToken || env.AMAZON_REFRESH_TOKEN || '',
      marketplaces: stored.amazon?.marketplaces || env.AMAZON_MARKETPLACES || '',
    },
    tiktok: {
      appKey: stored.tiktok?.appKey || env.TIKTOK_APP_KEY || '',
      appSecret: stored.tiktok?.appSecret || env.TIKTOK_APP_SECRET || '',
      serviceId: stored.tiktok?.serviceId || '',
    },
  }
}

// Shallow-merges a partial update per provider so saving one field (e.g. just the Etsy shop
// id) never wipes the others.
async function saveConfig(env: Env, provider: keyof StoreConfig, fields: Record<string, string>): Promise<void> {
  const current = await getConfig(env)
  const next: StoreConfig = { ...current, [provider]: { ...current[provider], ...fields } }
  await env.PUSH_KV.put('config', JSON.stringify(next))
}

function configStatus(cfg: StoreConfig) {
  return {
    etsy: { configured: Boolean(cfg.etsy.keystring && cfg.etsy.sharedSecret && cfg.etsy.shopId), shopId: cfg.etsy.shopId },
    amazon: { configured: Boolean(cfg.amazon.clientId && cfg.amazon.clientSecret && cfg.amazon.refreshToken), marketplaces: cfg.amazon.marketplaces },
    tiktok: { configured: Boolean(cfg.tiktok.appKey && cfg.tiktok.appSecret && cfg.tiktok.serviceId) },
  }
}

interface NormalizedOrder {
  id: string
  store: 'etsy' | 'amazon' | 'tiktok'
  product: string
  buyer: string
  amount: number
  currency: string
  status: 'unshipped' | 'shipped' | 'completed' | 'canceled'
  createdAt: string
}

const AMAZON_SP_ENDPOINT = 'https://sellingpartnerapi-na.amazon.com'

interface PushSub {
  endpoint: string
  keys: { p256dh: string; auth: string }
  expirationTime?: number | null
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

async function getSubs(env: Env): Promise<PushSub[]> {
  return JSON.parse((await env.PUSH_KV.get('subs')) || '[]')
}

interface PushMessage {
  title: string
  body: string
  url?: string
  count?: number
}

// Plain Web Push: the SW `push` handler shows the notification (and attempts the icon
// badge). NOTE: Declarative Web Push (app_badge) was tried and DROPPED by iOS 26 — it
// recognized the payload but never displayed it, and didn't fall back to the SW, so
// NOTHING showed. Reverted to plain push so notifications work. See CLAUDE.md.
async function sendPush(env: Env, sub: PushSub, message: PushMessage): Promise<number> {
  const payload = await buildPushPayload(
    { data: JSON.stringify(message), options: { ttl: 120 } },
    sub,
    { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE },
  )
  const res = await fetch(sub.endpoint, payload as RequestInit)
  return res.status
}

async function pushToAll(env: Env, message: PushMessage): Promise<number> {
  const subs = await getSubs(env)
  const stillValid: PushSub[] = []
  let sent = 0
  for (const sub of subs) {
    try {
      const status = await sendPush(env, sub, message)
      if (status === 404 || status === 410) continue // expired -> drop
      if (status >= 200 && status < 300) sent++
      stillValid.push(sub)
    } catch {
      stillValid.push(sub)
    }
  }
  await env.PUSH_KV.put('subs', JSON.stringify(stillValid))
  return sent
}

async function pollEtsy(env: Env): Promise<void> {
  const refresh = await env.PUSH_KV.get('etsy:refresh')
  if (!refresh) return
  const cfg = (await getConfig(env)).etsy
  if (!cfg.keystring) return

  // refresh access token (rotates the refresh token)
  const tokenResp = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cfg.keystring,
      refresh_token: refresh,
    }),
  })
  if (!tokenResp.ok) return
  const t = (await tokenResp.json()) as { access_token: string; refresh_token?: string }
  if (t.refresh_token) await env.PUSH_KV.put('etsy:refresh', t.refresh_token)

  const r = await fetch(
    `https://openapi.etsy.com/v3/application/shops/${cfg.shopId}/receipts?limit=25&sort_on=created&sort_order=desc`,
    {
      headers: {
        'x-api-key': `${cfg.keystring}:${cfg.sharedSecret}`,
        Authorization: `Bearer ${t.access_token}`,
      },
    },
  )
  if (!r.ok) return
  const data = (await r.json()) as {
    results: Array<{
      receipt_id: number
      name: string
      is_shipped: boolean
      grandtotal: { amount: number; divisor: number }
      transactions: Array<{ title: string }>
    }>
  }

  // Open orders awaiting shipment -> drives the home-screen icon badge count.
  const etsyOpen = data.results.filter(rc => !rc.is_shipped).length
  await env.PUSH_KV.put('etsy:open', String(etsyOpen))
  const toShip = etsyOpen + (Number(await env.PUSH_KV.get('amz:open')) || 0) + (Number(await env.PUSH_KV.get('tiktok:open')) || 0)

  const seen: number[] = JSON.parse((await env.PUSH_KV.get('seen')) || '[]')
  const seenSet = new Set(seen)
  const isFirstRun = seen.length === 0
  const currentIds = data.results.map(rc => rc.receipt_id)

  if (!isFirstRun) {
    // Notify oldest-new first so the newest ends on top of the notification stack.
    const newOnes = data.results.filter(rc => !seenSet.has(rc.receipt_id)).reverse()
    for (const rc of newOnes) {
      const total = rc.grandtotal.amount / rc.grandtotal.divisor
      const product = rc.transactions?.[0]?.title ?? 'New order'
      await pushToAll(env, {
        title: '🧵 New Etsy order',
        body: `${rc.name} — ${product} ($${total.toFixed(2)})`,
        url: '/',
        count: toShip,
      })
    }
  }

  await env.PUSH_KV.put('seen', JSON.stringify(currentIds))
}

// Refresh the stored Etsy refresh token → access token (rotates the refresh token in KV).
async function getEtsyAccessToken(env: Env): Promise<string | null> {
  const refresh = await env.PUSH_KV.get('etsy:refresh')
  if (!refresh) return null
  const cfg = (await getConfig(env)).etsy
  if (!cfg.keystring) return null
  const tr = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: cfg.keystring, refresh_token: refresh }),
  })
  if (!tr.ok) return null
  const t = (await tr.json()) as { access_token: string; refresh_token?: string }
  if (t.refresh_token) await env.PUSH_KV.put('etsy:refresh', t.refresh_token)
  return t.access_token
}

interface EtsyListingOut {
  id: number; title: string; state: string; quantity: number
  price: number; currency: string; views: number; numFavorers: number; url: string
}

// Etsy shop listings: active + draft in detail, plus counts of every state.
async function fetchEtsyListingsData(env: Env): Promise<{ listings: EtsyListingOut[]; counts: Record<string, number>; updatedAt: number } | null> {
  const at = await getEtsyAccessToken(env)
  if (!at) return null
  const cfg = (await getConfig(env)).etsy
  const hdr = { 'x-api-key': `${cfg.keystring}:${cfg.sharedSecret}`, Authorization: `Bearer ${at}` }
  const base = `https://openapi.etsy.com/v3/application/shops/${cfg.shopId}/listings`
  const listings: EtsyListingOut[] = []
  const counts: Record<string, number> = {}
  const detailStates = new Set(['active', 'draft'])
  for (const state of ['active', 'draft', 'sold_out', 'inactive']) {
    const r = await fetch(`${base}?state=${state}&limit=100`, { headers: hdr })
    if (!r.ok) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = (await r.json()) as { count?: number; results?: any[] }
    counts[state] = j.count ?? 0
    if (detailStates.has(state)) {
      for (const l of j.results ?? []) {
        listings.push({
          id: l.listing_id,
          title: l.title,
          state: l.state,
          quantity: Number(l.quantity ?? 0),
          price: l.price ? Number(l.price.amount) / Number(l.price.divisor || 100) : 0,
          currency: l.price?.currency_code ?? 'USD',
          views: Number(l.views ?? 0),
          numFavorers: Number(l.num_favorers ?? 0),
          url: l.url ?? '',
        })
      }
    }
  }
  return { listings, counts, updatedAt: Date.now() }
}

// ── Amazon SP-API ──────────────────────────────────────────────
async function getAmazonAccessToken(env: Env): Promise<string | null> {
  const cfg = (await getConfig(env)).amazon
  if (!cfg.refreshToken) return null
  const resp = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  })
  if (!resp.ok) return null
  const t = (await resp.json()) as { access_token?: string }
  return t.access_token ?? null
}

function mapAmazonStatus(s: string, unshipped?: number): NormalizedOrder['status'] {
  const v = (s || '').toLowerCase()
  if (v === 'canceled' || v === 'cancelled') return 'canceled'
  if (v === 'shipped') return 'shipped'
  if (v === 'pending' || v === 'unshipped' || v === 'partiallyshipped') return 'unshipped'
  if (unshipped && unshipped > 0) return 'unshipped'
  return 'completed'
}

async function fetchAmazonOrders(env: Env): Promise<NormalizedOrder[]> {
  const at = await getAmazonAccessToken(env)
  if (!at) return []
  const after = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z')
  const marketplaces = (await getConfig(env)).amazon.marketplaces
  const params = new URLSearchParams({ MarketplaceIds: marketplaces, CreatedAfter: after })
  const r = await fetch(`${AMAZON_SP_ENDPOINT}/orders/v0/orders?${params}`, {
    headers: { 'x-amz-access-token': at },
  })
  if (!r.ok) return []
  const data = (await r.json()) as { payload?: { Orders?: Array<Record<string, unknown>> } }
  const orders = data.payload?.Orders ?? []
  return orders.map(o => {
    const total = o.OrderTotal as { Amount?: string; CurrencyCode?: string } | undefined
    const itemCount = (Number(o.NumberOfItemsShipped) || 0) + (Number(o.NumberOfItemsUnshipped) || 0)
    return {
      id: `amazon-${o.AmazonOrderId}`,
      store: 'amazon' as const,
      product: itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Amazon order',
      buyer: 'Amazon customer',
      amount: total?.Amount ? Number(total.Amount) : 0,
      currency: total?.CurrencyCode ?? '',
      status: mapAmazonStatus(String(o.OrderStatus ?? ''), Number(o.NumberOfItemsUnshipped)),
      createdAt: (o.PurchaseDate as string) ?? new Date().toISOString(),
    }
  })
}

async function pollAmazon(env: Env): Promise<void> {
  const orders = await fetchAmazonOrders(env)
  await env.PUSH_KV.put('amz:orders', JSON.stringify(orders)) // cache for dashboard
  const amzOpen = orders.filter(o => o.status === 'unshipped').length
  await env.PUSH_KV.put('amz:open', String(amzOpen))
  const toShip = amzOpen + (Number(await env.PUSH_KV.get('etsy:open')) || 0) + (Number(await env.PUSH_KV.get('tiktok:open')) || 0)
  const seen: string[] = JSON.parse((await env.PUSH_KV.get('amz:seen')) || '[]')
  const seenSet = new Set(seen)
  const isFirstRun = seen.length === 0
  if (!isFirstRun) {
    const newOnes = orders.filter(o => !seenSet.has(o.id) && o.status !== 'canceled').reverse()
    for (const o of newOnes) {
      await pushToAll(env, {
        title: '📦 New Amazon order',
        body: `${o.product} — $${o.amount.toFixed(2)} ${o.currency}`,
        url: '/',
        count: toShip,
      })
    }
  }
  await env.PUSH_KV.put('amz:seen', JSON.stringify(orders.map(o => o.id)))
}

// ── Amazon Sales & Traffic report (async: request → poll → download → cache) ──
const US_MARKETPLACE = 'ATVPDKIKX0DER'

interface STSummary {
  updatedAt: number
  rangeDays: number
  totals: {
    sessions: number; pageViews: number; units: number; sales: number
    currency: string; conversionPct: number; buyBoxPct: number
  }
  daily: Array<{ date: string; sessions: number; units: number; sales: number }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeTraffic(data: any): STSummary {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = Array.isArray(data?.salesAndTrafficByDate) ? data.salesAndTrafficByDate : []
  let sessions = 0, pageViews = 0, units = 0, sales = 0, buyBoxWeighted = 0
  let currency = 'USD'
  const daily: STSummary['daily'] = []
  for (const row of rows) {
    const t = row.trafficByDate ?? {}
    const s = row.salesByDate ?? {}
    const sess = Number(t.sessions ?? 0)
    const u = Number(s.unitsOrdered ?? 0)
    const amt = Number(s.orderedProductSales?.amount ?? 0)
    if (s.orderedProductSales?.currencyCode) currency = s.orderedProductSales.currencyCode
    sessions += sess; pageViews += Number(t.pageViews ?? 0); units += u; sales += amt
    buyBoxWeighted += Number(t.buyBoxPercentage ?? 0) * (sess || 1)
    daily.push({ date: String(row.date ?? ''), sessions: sess, units: u, sales: amt })
  }
  return {
    updatedAt: Date.now(),
    rangeDays: rows.length,
    totals: {
      sessions, pageViews, units, sales, currency,
      conversionPct: sessions ? (units / sessions) * 100 : 0,
      buyBoxPct: sessions ? buyBoxWeighted / sessions : 0,
    },
    daily,
  }
}

// Per-product (per-ASIN) traffic from the same report: sessions, page views, conversion.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractByAsin(data: any): Record<string, { sessions: number; pageViews: number; units: number; conversionPct: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = Array.isArray(data?.salesAndTrafficByAsin) ? data.salesAndTrafficByAsin : []
  const map: Record<string, { sessions: number; pageViews: number; units: number; conversionPct: number }> = {}
  for (const row of rows) {
    const asin = row.childAsin || row.parentAsin
    if (!asin) continue
    const t = row.trafficByAsin ?? {}
    const s = row.salesByAsin ?? {}
    map[asin] = {
      sessions: Number(t.sessions ?? 0),
      pageViews: Number(t.pageViews ?? 0),
      units: Number(s.unitsOrdered ?? 0),
      conversionPct: Number(t.unitSessionPercentage ?? 0),
    }
  }
  return map
}

async function requestSalesTrafficReport(env: Env, at: string): Promise<string | null> {
  const end = new Date(Date.now() - 2 * 86400000) // Sales & Traffic lags ~2 days
  const start = new Date(end.getTime() - 28 * 86400000)
  const r = await fetch(`${AMAZON_SP_ENDPOINT}/reports/2021-06-30/reports`, {
    method: 'POST',
    headers: { 'x-amz-access-token': at, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
      marketplaceIds: [US_MARKETPLACE],
      dataStartTime: start.toISOString(),
      dataEndTime: end.toISOString(),
      reportOptions: { dateGranularity: 'DAY', asinGranularity: 'CHILD' },
    }),
  })
  if (!r.ok) return null
  const j = (await r.json()) as { reportId?: string }
  return j.reportId ?? null
}

// State machine across cron ticks (reports take minutes to generate).
async function refreshTraffic(env: Env): Promise<void> {
  const at = await getAmazonAccessToken(env)
  if (!at) return
  const hdr = { 'x-amz-access-token': at }
  const pendingId = await env.PUSH_KV.get('amz:traffic:reportId')

  if (pendingId) {
    const rr = await fetch(`${AMAZON_SP_ENDPOINT}/reports/2021-06-30/reports/${pendingId}`, { headers: hdr })
    if (!rr.ok) { await env.PUSH_KV.delete('amz:traffic:reportId'); return }
    const rep = (await rr.json()) as { processingStatus?: string; reportDocumentId?: string }
    if (rep.processingStatus === 'DONE' && rep.reportDocumentId) {
      const dr = await fetch(`${AMAZON_SP_ENDPOINT}/reports/2021-06-30/documents/${rep.reportDocumentId}`, { headers: hdr })
      if (dr.ok) {
        const doc = (await dr.json()) as { url: string; compressionAlgorithm?: string }
        const resp = await fetch(doc.url)
        const text = doc.compressionAlgorithm === 'GZIP'
          ? await new Response(resp.body!.pipeThrough(new DecompressionStream('gzip'))).text()
          : await resp.text()
        const parsed = JSON.parse(text)
        await env.PUSH_KV.put('amz:traffic', JSON.stringify(summarizeTraffic(parsed)))
        await env.PUSH_KV.put('amz:traffic:byasin', JSON.stringify(extractByAsin(parsed)))
        await env.PUSH_KV.put('amz:traffic:ts', String(Date.now()))
      }
      await env.PUSH_KV.delete('amz:traffic:reportId')
    } else if (rep.processingStatus === 'FATAL' || rep.processingStatus === 'CANCELLED') {
      await env.PUSH_KV.delete('amz:traffic:reportId')
    }
    return
  }

  // No report in flight: request a fresh one if the cache is stale (>12h).
  const ts = Number((await env.PUSH_KV.get('amz:traffic:ts')) || 0)
  if (Date.now() - ts > 12 * 3600 * 1000) {
    const id = await requestSalesTrafficReport(env, at)
    if (id) await env.PUSH_KV.put('amz:traffic:reportId', id)
  }
}

// ── Amazon merchant listings report (async, TSV) ──────────────────────
interface AmzListingOut {
  sku: string; asin: string; title: string; price: number; quantity: number; status: string; url: string
}

function parseMerchantListingsTsv(text: string): { listings: AmzListingOut[]; headers: string } {
  const lines = text.split(/\r?\n/).filter(l => l.length)
  if (!lines.length) return { listings: [], headers: '' }
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase())
  const col = (name: string) => headers.indexOf(name)
  const iName = col('item-name')
  const iSku = col('seller-sku')
  const iPrice = col('price')
  const iQty = col('quantity')
  const iAsin = col('asin1') >= 0 ? col('asin1') : col('product-id')
  const iStatus = col('status')
  const listings: AmzListingOut[] = []
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t')
    const asin = iAsin >= 0 ? (c[iAsin] ?? '').trim() : ''
    listings.push({
      sku: iSku >= 0 ? (c[iSku] ?? '').trim() : '',
      asin,
      title: iName >= 0 ? (c[iName] ?? '').trim() : '',
      price: iPrice >= 0 ? Number(c[iPrice]) || 0 : 0,
      quantity: iQty >= 0 ? Number(c[iQty]) || 0 : 0,
      status: iStatus >= 0 ? (c[iStatus] ?? '').trim() : '',
      url: asin ? `https://www.amazon.com/dp/${asin}` : '',
    })
  }
  return { listings, headers: lines[0] }
}

// State machine across cron ticks (TSV report takes minutes to generate).
async function refreshAmzListings(env: Env): Promise<void> {
  const at = await getAmazonAccessToken(env)
  if (!at) return
  const hdr = { 'x-amz-access-token': at }
  const pendingId = await env.PUSH_KV.get('amz:listings:reportId')

  if (pendingId) {
    const rr = await fetch(`${AMAZON_SP_ENDPOINT}/reports/2021-06-30/reports/${pendingId}`, { headers: hdr })
    if (!rr.ok) { await env.PUSH_KV.delete('amz:listings:reportId'); return }
    const rep = (await rr.json()) as { processingStatus?: string; reportDocumentId?: string }
    if (rep.processingStatus === 'DONE' && rep.reportDocumentId) {
      const dr = await fetch(`${AMAZON_SP_ENDPOINT}/reports/2021-06-30/documents/${rep.reportDocumentId}`, { headers: hdr })
      if (dr.ok) {
        const doc = (await dr.json()) as { url: string; compressionAlgorithm?: string }
        const resp = await fetch(doc.url)
        const text = doc.compressionAlgorithm === 'GZIP'
          ? await new Response(resp.body!.pipeThrough(new DecompressionStream('gzip'))).text()
          : await resp.text()
        const parsed = parseMerchantListingsTsv(text)
        await env.PUSH_KV.put('amz:listings', JSON.stringify({ listings: parsed.listings, updatedAt: Date.now() }))
        await env.PUSH_KV.put('amz:listings:ts', String(Date.now()))
      }
      await env.PUSH_KV.delete('amz:listings:reportId')
    } else if (rep.processingStatus === 'FATAL' || rep.processingStatus === 'CANCELLED') {
      await env.PUSH_KV.delete('amz:listings:reportId')
    }
    return
  }

  const ts = Number((await env.PUSH_KV.get('amz:listings:ts')) || 0)
  if (Date.now() - ts > 6 * 3600 * 1000) {
    const marketplaces = (await getConfig(env)).amazon.marketplaces
    const r = await fetch(`${AMAZON_SP_ENDPOINT}/reports/2021-06-30/reports`, {
      method: 'POST',
      headers: { ...hdr, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA', marketplaceIds: marketplaces.split(',') }),
    })
    if (r.ok) {
      const j = (await r.json()) as { reportId?: string }
      if (j.reportId) await env.PUSH_KV.put('amz:listings:reportId', j.reportId)
    }
  }
}

// ── TikTok Shop (API 202309) ───────────────────────────────────
// Auth host (token get/refresh) is NOT signed. The API host IS signed with HMAC-SHA256
// over: path + sorted {k}{v} params (excluding sign/access_token) + raw body, wrapped in
// app_secret on both ends. sign+timestamp+app_key+shop_cipher go as query; token in header.
const TIKTOK_AUTH_HOST = 'https://auth.tiktok-shops.com'
const TIKTOK_API_HOST = 'https://open-api.tiktokglobalshop.com'

async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function tiktokSign(env: Env, path: string, query: Record<string, string>, body: string | null): Promise<string> {
  const { appSecret } = (await getConfig(env)).tiktok
  const keys = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token').sort()
  let s = path
  for (const k of keys) s += k + query[k]
  if (body) s += body
  s = appSecret + s + appSecret
  return hmacSha256Hex(appSecret, s)
}

// Signed call against the API host. `extraQuery` adds endpoint-specific params (e.g. page_size).
async function tiktokSignedFetch(
  env: Env, method: 'GET' | 'POST', path: string, accessToken: string,
  extraQuery: Record<string, string> = {}, body: unknown = null,
): Promise<Response> {
  const bodyStr = body !== null ? JSON.stringify(body) : null
  const { appKey } = (await getConfig(env)).tiktok
  const query: Record<string, string> = {
    app_key: appKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...extraQuery,
  }
  query.sign = await tiktokSign(env, path, query, bodyStr)
  const qs = new URLSearchParams(query).toString()
  return fetch(`${TIKTOK_API_HOST}${path}?${qs}`, {
    method,
    headers: {
      'x-tts-access-token': accessToken,
      'Content-Type': 'application/json',
    },
    body: bodyStr ?? undefined,
  })
}

// Refresh the stored TikTok refresh token → access token (rotates the refresh token in KV).
async function getTiktokAccessToken(env: Env): Promise<string | null> {
  const refresh = await env.PUSH_KV.get('tiktok:refresh')
  if (!refresh) return null
  const cfg = (await getConfig(env)).tiktok
  if (!cfg.appKey) return null
  const q = new URLSearchParams({
    app_key: cfg.appKey,
    app_secret: cfg.appSecret,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  })
  const r = await fetch(`${TIKTOK_AUTH_HOST}/api/v2/token/refresh?${q}`)
  if (!r.ok) return null
  const j = (await r.json()) as { code: number; data?: { access_token?: string; refresh_token?: string } }
  if (j.code !== 0 || !j.data?.access_token) return null
  if (j.data.refresh_token) await env.PUSH_KV.put('tiktok:refresh', j.data.refresh_token)
  return j.data.access_token
}

// shop_cipher identifies which shop's data to read; fetched once after authorization.
async function getTiktokCipher(env: Env, at: string): Promise<string | null> {
  const cached = await env.PUSH_KV.get('tiktok:cipher')
  if (cached) return cached
  const r = await tiktokSignedFetch(env, 'GET', '/authorization/202309/shops', at)
  if (!r.ok) return null
  const j = (await r.json()) as { code: number; data?: { shops?: Array<{ cipher?: string; id?: string; name?: string }> } }
  const shop = j.data?.shops?.[0]
  if (!shop?.cipher) return null
  await env.PUSH_KV.put('tiktok:cipher', shop.cipher)
  if (shop.id) await env.PUSH_KV.put('tiktok:shopid', shop.id)
  return shop.cipher
}

function mapTiktokStatus(s: string): NormalizedOrder['status'] {
  const v = (s || '').toUpperCase()
  if (v === 'CANCELLED' || v === 'CANCELED') return 'canceled'
  if (v === 'COMPLETED' || v === 'DELIVERED') return 'completed'
  if (v === 'IN_TRANSIT' || v === 'SHIPPED') return 'shipped'
  // UNPAID, ON_HOLD, AWAITING_SHIPMENT, AWAITING_COLLECTION, PARTIALLY_SHIPPING → still to ship
  return 'unshipped'
}

async function fetchTiktokOrders(env: Env): Promise<NormalizedOrder[]> {
  const at = await getTiktokAccessToken(env)
  if (!at) return []
  const cipher = await getTiktokCipher(env, at)
  if (!cipher) return []
  const since = Math.floor((Date.now() - 30 * 24 * 3600 * 1000) / 1000)
  const r = await tiktokSignedFetch(
    env, 'POST', '/order/202309/orders/search', at,
    { shop_cipher: cipher, page_size: '50', sort_field: 'create_time', sort_order: 'DESC' },
    { create_time_ge: since },
  )
  if (!r.ok) return []
  const j = (await r.json()) as {
    code: number
    data?: {
      orders?: Array<{
        id: string
        order_status?: string
        status?: string
        payment?: { total_amount?: string; currency?: string }
        recipient_address?: { name?: string }
        line_items?: Array<{ product_name?: string }>
        create_time?: number
      }>
    }
  }
  const orders = j.data?.orders ?? []
  return orders.map(o => {
    const items = o.line_items ?? []
    const product = items[0]?.product_name
      ? (items.length > 1 ? `${items[0].product_name} +${items.length - 1}` : items[0].product_name!)
      : 'TikTok order'
    return {
      id: `tiktok-${o.id}`,
      store: 'tiktok' as const,
      product,
      buyer: o.recipient_address?.name ?? 'TikTok customer',
      amount: o.payment?.total_amount ? Number(o.payment.total_amount) : 0,
      currency: o.payment?.currency ?? '',
      status: mapTiktokStatus(o.order_status ?? o.status ?? ''),
      createdAt: o.create_time ? new Date(o.create_time * 1000).toISOString() : new Date().toISOString(),
    }
  })
}

async function pollTiktok(env: Env): Promise<void> {
  const refresh = await env.PUSH_KV.get('tiktok:refresh')
  if (!refresh) return // not connected yet
  const orders = await fetchTiktokOrders(env)
  await env.PUSH_KV.put('tiktok:orders', JSON.stringify(orders)) // cache for dashboard
  const ttOpen = orders.filter(o => o.status === 'unshipped').length
  await env.PUSH_KV.put('tiktok:open', String(ttOpen))
  const toShip = ttOpen + (Number(await env.PUSH_KV.get('etsy:open')) || 0) + (Number(await env.PUSH_KV.get('amz:open')) || 0)
  const seen: string[] = JSON.parse((await env.PUSH_KV.get('tiktok:seen')) || '[]')
  const seenSet = new Set(seen)
  const isFirstRun = seen.length === 0
  if (!isFirstRun) {
    const newOnes = orders.filter(o => !seenSet.has(o.id) && o.status !== 'canceled').reverse()
    for (const o of newOnes) {
      await pushToAll(env, {
        title: '🎵 New TikTok order',
        body: `${o.buyer} — ${o.product}${o.amount ? ` ($${o.amount.toFixed(2)} ${o.currency})` : ''}`,
        url: '/',
        count: toShip,
      })
    }
  }
  await env.PUSH_KV.put('tiktok:seen', JSON.stringify(orders.map(o => o.id)))
}

// ── TikTok product listings (status, stock, price) ──────────────
interface TiktokListingOut {
  id: string; title: string; status: string; quantity: number
  price: number; currency: string; url: string
}

async function fetchTiktokListingsData(env: Env): Promise<{ listings: TiktokListingOut[]; updatedAt: number } | null> {
  const at = await getTiktokAccessToken(env)
  if (!at) return null
  const cipher = await getTiktokCipher(env, at)
  if (!cipher) return null
  const r = await tiktokSignedFetch(
    env, 'POST', '/product/202309/products/search', at,
    { shop_cipher: cipher, page_size: '50' },
    { status: 'ALL' },
  )
  if (!r.ok) return null
  const j = (await r.json()) as {
    code: number
    data?: {
      products?: Array<{
        id: string
        title?: string
        status?: string
        skus?: Array<{ price?: { sale_price?: string; currency?: string }; inventory?: Array<{ quantity?: number }> }>
      }>
    }
  }
  const listings: TiktokListingOut[] = (j.data?.products ?? []).map(p => {
    const sku = p.skus?.[0]
    const quantity = (p.skus ?? []).reduce(
      (sum, s) => sum + (s.inventory ?? []).reduce((q, inv) => q + (Number(inv.quantity) || 0), 0), 0,
    )
    return {
      id: p.id,
      title: p.title ?? '',
      status: p.status ?? '',
      quantity,
      price: sku?.price?.sale_price ? Number(sku.price.sale_price) : 0,
      currency: sku?.price?.currency ?? '',
      url: `https://seller-us.tiktok.com/product/edit/${p.id}`,
    }
  })
  return { listings, updatedAt: Date.now() }
}

async function refreshTiktokListings(env: Env): Promise<void> {
  const refresh = await env.PUSH_KV.get('tiktok:refresh')
  if (!refresh) return
  const ts = Number((await env.PUSH_KV.get('tiktok:listings:ts')) || 0)
  if (Date.now() - ts < 30 * 60 * 1000) return // cache 30min
  const data = await fetchTiktokListingsData(env)
  if (!data) return
  await env.PUSH_KV.put('tiktok:listings', JSON.stringify(data))
  await env.PUSH_KV.put('tiktok:listings:ts', String(Date.now()))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const url = new URL(request.url)

    // ── Connections config: lets anyone running their own copy of ShopLens plug in
    // their own Etsy/Amazon/TikTok app credentials from Settings, instead of a
    // developer hardcoding one person's accounts at deploy time. ──
    if (url.pathname === '/config' && request.method === 'GET') {
      return json(configStatus(await getConfig(env)))
    }

    if (url.pathname === '/config' && request.method === 'POST') {
      const body = (await request.json()) as { provider?: string; fields?: Record<string, string> }
      if (body.provider !== 'etsy' && body.provider !== 'amazon' && body.provider !== 'tiktok') {
        return json({ error: 'invalid provider' }, 400)
      }
      if (!body.fields || typeof body.fields !== 'object') return json({ error: 'missing fields' }, 400)
      // Only accept known keys per provider — never let an arbitrary field in.
      const allowed: Record<string, string[]> = {
        etsy: ['keystring', 'sharedSecret', 'shopId'],
        amazon: ['clientId', 'clientSecret', 'refreshToken', 'marketplaces'],
        tiktok: ['appKey', 'appSecret', 'serviceId'],
      }
      const fields: Record<string, string> = {}
      for (const k of allowed[body.provider]) {
        if (typeof body.fields[k] === 'string') fields[k] = body.fields[k]
      }
      await saveConfig(env, body.provider as keyof StoreConfig, fields)
      return json({ ok: true, status: configStatus(await getConfig(env)) })
    }

    if (url.pathname === '/config' && request.method === 'DELETE') {
      const provider = url.searchParams.get('provider')
      if (provider !== 'etsy' && provider !== 'amazon' && provider !== 'tiktok') {
        return json({ error: 'invalid provider' }, 400)
      }
      const blank: Record<string, Record<string, string>> = {
        etsy: { keystring: '', sharedSecret: '', shopId: '' },
        amazon: { clientId: '', clientSecret: '', refreshToken: '', marketplaces: '' },
        tiktok: { appKey: '', appSecret: '', serviceId: '' },
      }
      await saveConfig(env, provider, blank[provider])
      return json({ ok: true })
    }

    // Builds the Etsy authorize URL server-side (holds the keystring) so the Pages
    // Function never needs its own copy of it. redirect_uri is supplied by the caller
    // (derived from its own origin) so this works on any domain, not just one hardcoded one.
    if (url.pathname === '/etsy/authorize-url' && request.method === 'GET') {
      const cfg = (await getConfig(env)).etsy
      if (!cfg.keystring) return json({ error: 'Etsy not configured' }, 400)
      const codeChallenge = url.searchParams.get('code_challenge')
      const state = url.searchParams.get('state')
      const redirectUri = url.searchParams.get('redirect_uri')
      if (!codeChallenge || !state || !redirectUri) return json({ error: 'missing params' }, 400)
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.keystring,
        redirect_uri: redirectUri,
        scope: 'transactions_r shops_r listings_r',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      return json({ url: `https://www.etsy.com/oauth/connect?${params}` })
    }

    // Exchanges the Etsy PKCE code for tokens server-side (same reasoning as above).
    if (url.pathname === '/etsy/token-exchange' && request.method === 'POST') {
      const cfg = (await getConfig(env)).etsy
      if (!cfg.keystring) return json({ error: 'Etsy not configured' }, 400)
      const body = (await request.json()) as { code?: string; codeVerifier?: string; redirectUri?: string }
      if (!body.code || !body.codeVerifier || !body.redirectUri) return json({ error: 'missing params' }, 400)
      const resp = await fetch('https://api.etsy.com/v3/public/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: cfg.keystring,
          redirect_uri: body.redirectUri,
          code: body.code,
          code_verifier: body.codeVerifier,
        }),
      })
      if (!resp.ok) return new Response(await resp.text(), { status: resp.status, headers: CORS })
      const tokens = (await resp.json()) as { access_token: string; refresh_token: string; expires_in: number }
      return json({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      })
    }

    // Builds the TikTok authorize URL server-side (holds the app key).
    if (url.pathname === '/tiktok/authorize-url' && request.method === 'GET') {
      const cfg = (await getConfig(env)).tiktok
      if (!cfg.appKey || !cfg.serviceId) return json({ error: 'TikTok not configured' }, 400)
      const params = new URLSearchParams({
        service_id: cfg.serviceId,
        app_key: cfg.appKey,
        state: crypto.randomUUID(),
      })
      return json({ url: `https://services.tiktokshop.com/open/authorize?${params}` })
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const body = (await request.json()) as { subscription?: PushSub; etsyRefreshToken?: string }
      if (!body.subscription?.endpoint) return json({ error: 'missing subscription' }, 400)
      if (body.etsyRefreshToken) await env.PUSH_KV.put('etsy:refresh', body.etsyRefreshToken)
      const subs = await getSubs(env)
      const deduped = subs.filter(s => s.endpoint !== body.subscription!.endpoint)
      deduped.push(body.subscription)
      await env.PUSH_KV.put('subs', JSON.stringify(deduped))
      return json({ ok: true, subscribers: deduped.length })
    }

    if (url.pathname === '/test' && request.method === 'POST') {
      const override = url.searchParams.get('badge')
      const count =
        override !== null
          ? Number(override)
          : (Number(await env.PUSH_KV.get('etsy:open')) || 0) +
            (Number(await env.PUSH_KV.get('amz:open')) || 0) +
            (Number(await env.PUSH_KV.get('tiktok:open')) || 0)
      const sent = await pushToAll(env, {
        title: '🔔 ShopLens',
        body: 'Notifications are working! You will be alerted on new orders.',
        url: '/',
        count,
      })
      return json({ ok: true, sent, count })
    }

    if (url.pathname === '/amazon/orders' && request.method === 'GET') {
      let cached = await env.PUSH_KV.get('amz:orders')
      if (!cached) {
        const orders = await fetchAmazonOrders(env)
        cached = JSON.stringify(orders)
        await env.PUSH_KV.put('amz:orders', cached)
      }
      return new Response(cached, { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    if (url.pathname === '/amazon/traffic' && request.method === 'GET') {
      const cached = await env.PUSH_KV.get('amz:traffic')
      if (cached) return new Response(cached, { headers: { 'Content-Type': 'application/json', ...CORS } })
      await refreshTraffic(env) // kick off generation; data lands on a later cron tick
      return json({ status: 'pending' })
    }

    if (url.pathname === '/amazon/listings' && request.method === 'GET') {
      const cached = await env.PUSH_KV.get('amz:listings')
      if (!cached) {
        await refreshAmzListings(env) // kick off generation; data lands on a later cron tick
        return json({ status: 'pending' })
      }
      // Enrich each listing with its per-ASIN traffic (sessions/conversion) from Sales & Traffic.
      const byasin = JSON.parse((await env.PUSH_KV.get('amz:traffic:byasin')) || '{}') as
        Record<string, { sessions: number; pageViews: number; conversionPct: number }>
      const data = JSON.parse(cached) as { listings: Array<Record<string, unknown>>; updatedAt: number }
      for (const l of data.listings ?? []) {
        const tr = byasin[l.asin as string]
        if (tr) { l.sessions = tr.sessions; l.pageViews = tr.pageViews; l.conversionPct = tr.conversionPct }
      }
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    if (url.pathname === '/poll' && request.method === 'POST') {
      // Manual trigger for testing all polls + traffic state machine.
      await pollEtsy(env)
      await pollAmazon(env)
      await pollTiktok(env)
      await refreshTraffic(env)
      await refreshAmzListings(env)
      await refreshTiktokListings(env)
      const trafficTs = Number((await env.PUSH_KV.get('amz:traffic:ts')) || 0)
      const listingsTs = Number((await env.PUSH_KV.get('amz:listings:ts')) || 0)
      return json({
        ok: true,
        trafficReportId: await env.PUSH_KV.get('amz:traffic:reportId'),
        trafficUpdated: trafficTs,
        listingsReportId: await env.PUSH_KV.get('amz:listings:reportId'),
        listingsUpdated: listingsTs,
      })
    }

    if (url.pathname === '/etsy/listings' && request.method === 'GET') {
      const cached = await env.PUSH_KV.get('etsy:listings')
      const ts = Number((await env.PUSH_KV.get('etsy:listings:ts')) || 0)
      if (cached && Date.now() - ts < 30 * 60 * 1000) {
        return new Response(cached, { headers: { 'Content-Type': 'application/json', ...CORS } })
      }
      const data = await fetchEtsyListingsData(env)
      if (!data) return json({ error: 'etsy not connected' }, 503)
      const body = JSON.stringify(data)
      await env.PUSH_KV.put('etsy:listings', body)
      await env.PUSH_KV.put('etsy:listings:ts', String(Date.now()))
      return new Response(body, { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    // TikTok OAuth: exchange the auth_code for tokens (server-side, holds app_secret),
    // then fetch + store the shop_cipher. Called by the Pages callback function.
    if (url.pathname === '/tiktok/exchange' && request.method === 'POST') {
      const body = (await request.json()) as { code?: string }
      if (!body.code) return json({ error: 'missing code' }, 400)
      const tiktokCfg = (await getConfig(env)).tiktok
      if (!tiktokCfg.appKey) return json({ error: 'TikTok not configured' }, 400)
      const q = new URLSearchParams({
        app_key: tiktokCfg.appKey,
        app_secret: tiktokCfg.appSecret,
        auth_code: body.code,
        grant_type: 'authorized_code',
      })
      const tr = await fetch(`${TIKTOK_AUTH_HOST}/api/v2/token/get?${q}`)
      const tj = (await tr.json()) as { code: number; message?: string; data?: { access_token?: string; refresh_token?: string } }
      if (tj.code !== 0 || !tj.data?.refresh_token || !tj.data.access_token) {
        return json({ error: 'token exchange failed', detail: tj.message ?? tj.code }, 502)
      }
      await env.PUSH_KV.put('tiktok:refresh', tj.data.refresh_token)
      await env.PUSH_KV.delete('tiktok:cipher') // force re-fetch for the freshly authorized shop
      const cipher = await getTiktokCipher(env, tj.data.access_token)
      return json({ ok: true, shop: cipher ? 'linked' : 'token stored (cipher pending)' })
    }

    if (url.pathname === '/tiktok/orders' && request.method === 'GET') {
      // Not connected (no OAuth yet) → 409 so the app shows TikTok as not connected.
      if (!(await env.PUSH_KV.get('tiktok:refresh'))) return json({ error: 'not connected' }, 409)
      let cached = await env.PUSH_KV.get('tiktok:orders')
      if (!cached) {
        const orders = await fetchTiktokOrders(env)
        cached = JSON.stringify(orders)
        await env.PUSH_KV.put('tiktok:orders', cached)
      }
      return new Response(cached, { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    if (url.pathname === '/tiktok/listings' && request.method === 'GET') {
      const cached = await env.PUSH_KV.get('tiktok:listings')
      if (!cached) {
        await refreshTiktokListings(env)
        const fresh = await env.PUSH_KV.get('tiktok:listings')
        if (!fresh) return json({ status: 'pending' })
        return new Response(fresh, { headers: { 'Content-Type': 'application/json', ...CORS } })
      }
      return new Response(cached, { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    return json({ service: 'shoplens-push', ok: true })
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await pollEtsy(env)
    await pollAmazon(env)
    await pollTiktok(env).catch(() => {})
    await refreshTraffic(env).catch(() => {})
    await refreshAmzListings(env).catch(() => {})
    await refreshTiktokListings(env).catch(() => {})
  },
}
