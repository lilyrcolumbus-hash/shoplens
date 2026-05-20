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
}

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

async function sendPush(env: Env, sub: PushSub, message: object): Promise<number> {
  const payload = await buildPushPayload(
    { data: JSON.stringify(message), options: { ttl: 120 } },
    sub,
    { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE },
  )
  const res = await fetch(sub.endpoint, payload as RequestInit)
  return res.status
}

async function pushToAll(env: Env, message: object): Promise<number> {
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
      grandtotal: { amount: number; divisor: number }
      transactions: Array<{ title: string }>
    }>
  }

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
      })
    }
  }

  await env.PUSH_KV.put('seen', JSON.stringify(currentIds))
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
      const sent = await pushToAll(env, {
        title: '🔔 ShopLens',
        body: 'Notifications are working! You will be alerted on new orders.',
        url: '/',
      })
      return json({ ok: true, sent })
    }

    if (url.pathname === '/poll' && request.method === 'POST') {
      // Manual trigger for testing the Etsy poll.
      await pollEtsy(env)
      return json({ ok: true })
    }

    return json({ service: 'shoplens-push', ok: true })
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await pollEtsy(env)
  },
}
