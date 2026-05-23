// ShopLens push worker.
// - fetch handler: POST /subscribe (store push subscription + Etsy refresh token),
//   POST /test (send a test push)
// - scheduled handler (cron): poll Etsy receipts, push on new orders.

import { buildPushPayload } from '@block65/webcrypto-web-push'

interface Env {
  PUSH_KV: KVNamespace
  ETSY_KEYSTRING: string
  ETSY_SHARED_SECRET: string
  ETSY_SHOP_ID: string
  VAPID_PUBLIC: string
  VAPID_PRIVATE: string
  VAPID_SUBJECT: string
  AMAZON_CLIENT_ID: string
  AMAZON_CLIENT_SECRET: string
  AMAZON_REFRESH_TOKEN: string
  AMAZON_MARKETPLACES: string
}

interface NormalizedOrder {
  id: string
  store: 'etsy' | 'amazon'
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

  // refresh access token (rotates the refresh token)
  const tokenResp = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.ETSY_KEYSTRING,
      refresh_token: refresh,
    }),
  })
  if (!tokenResp.ok) return
  const t = (await tokenResp.json()) as { access_token: string; refresh_token?: string }
  if (t.refresh_token) await env.PUSH_KV.put('etsy:refresh', t.refresh_token)

  const r = await fetch(
    `https://openapi.etsy.com/v3/application/shops/${env.ETSY_SHOP_ID}/receipts?limit=25&sort_on=created&sort_order=desc`,
    {
      headers: {
        'x-api-key': `${env.ETSY_KEYSTRING}:${env.ETSY_SHARED_SECRET}`,
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
  const toShip = etsyOpen + (Number(await env.PUSH_KV.get('amz:open')) || 0)

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
  const tr = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: env.ETSY_KEYSTRING, refresh_token: refresh }),
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
  const hdr = { 'x-api-key': `${env.ETSY_KEYSTRING}:${env.ETSY_SHARED_SECRET}`, Authorization: `Bearer ${at}` }
  const base = `https://openapi.etsy.com/v3/application/shops/${env.ETSY_SHOP_ID}/listings`
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
  const resp = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.AMAZON_REFRESH_TOKEN,
      client_id: env.AMAZON_CLIENT_ID,
      client_secret: env.AMAZON_CLIENT_SECRET,
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
  const params = new URLSearchParams({ MarketplaceIds: env.AMAZON_MARKETPLACES, CreatedAfter: after })
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
  const toShip = amzOpen + (Number(await env.PUSH_KV.get('etsy:open')) || 0)
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
      reportOptions: { dateGranularity: 'DAY', asinGranularity: 'PARENT' },
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
        await env.PUSH_KV.put('amz:traffic', JSON.stringify(summarizeTraffic(JSON.parse(text))))
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
    const r = await fetch(`${AMAZON_SP_ENDPOINT}/reports/2021-06-30/reports`, {
      method: 'POST',
      headers: { ...hdr, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA', marketplaceIds: env.AMAZON_MARKETPLACES.split(',') }),
    })
    if (r.ok) {
      const j = (await r.json()) as { reportId?: string }
      if (j.reportId) await env.PUSH_KV.put('amz:listings:reportId', j.reportId)
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const url = new URL(request.url)

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
            (Number(await env.PUSH_KV.get('amz:open')) || 0)
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
      if (cached) return new Response(cached, { headers: { 'Content-Type': 'application/json', ...CORS } })
      await refreshAmzListings(env) // kick off generation; data lands on a later cron tick
      return json({ status: 'pending' })
    }

    if (url.pathname === '/poll' && request.method === 'POST') {
      // Manual trigger for testing both polls + traffic state machine.
      await pollEtsy(env)
      await pollAmazon(env)
      await refreshTraffic(env)
      await refreshAmzListings(env)
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

    return json({ service: 'shoplens-push', ok: true })
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await pollEtsy(env)
    await pollAmazon(env)
    await refreshTraffic(env).catch(() => {})
    await refreshAmzListings(env).catch(() => {})
  },
}
