// GET /api/etsy/orders
// Proxies to Etsy's receipts endpoint.
// Client sends Bearer access_token in Authorization header.
// Returns normalized order list.

interface Env {
  ETSY_KEYSTRING: string
  ETSY_SHARED_SECRET: string
  ETSY_SHOP_ID: string
}

interface EtsyReceipt {
  receipt_id: number
  status: string
  grandtotal: { amount: number; divisor: number; currency_code: string }
  name: string
  created_timestamp: number
  is_shipped: boolean
  transactions: Array<{
    title: string
    quantity: number
    price: { amount: number; divisor: number; currency_code: string }
  }>
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return Response.json({ error: 'Missing Authorization header' }, { status: 401 })
  }
  const accessToken = auth.slice(7)

  const params = new URLSearchParams({
    limit: '25',
    sort_on: 'created',
    sort_order: 'desc',
  })

  const etsyResp = await fetch(
    `https://openapi.etsy.com/v3/application/shops/${env.ETSY_SHOP_ID}/receipts?${params}`,
    {
      headers: {
        'x-api-key': `${env.ETSY_KEYSTRING}:${env.ETSY_SHARED_SECRET}`,
        'Authorization': `Bearer ${accessToken}`,
      },
    },
  )

  if (etsyResp.status === 401) {
    return Response.json({ error: 'token_expired' }, { status: 401 })
  }
  if (!etsyResp.ok) {
    return Response.json({ error: `etsy_${etsyResp.status}`, detail: await etsyResp.text() }, { status: etsyResp.status })
  }

  const data = await etsyResp.json() as { count: number; results: EtsyReceipt[] }

  function mapStatus(r: EtsyReceipt): 'unshipped' | 'shipped' | 'completed' | 'canceled' {
    const s = (r.status || '').toLowerCase()
    if (s === 'canceled' || s.includes('refund')) return 'canceled'
    if (s === 'completed') return 'completed'
    if (r.is_shipped) return 'shipped'
    return 'unshipped'
  }

  const orders = data.results.map(r => {
    const totalAmount = r.grandtotal.amount / r.grandtotal.divisor
    const productTitle = r.transactions[0]?.title ?? 'Unknown product'
    const extraCount = Math.max(0, r.transactions.length - 1)
    return {
      id: `etsy-${r.receipt_id}`,
      store: 'etsy' as const,
      product: extraCount > 0 ? `${productTitle} + ${extraCount} more` : productTitle,
      buyer: r.name,
      amount: totalAmount,
      currency: r.grandtotal.currency_code,
      status: mapStatus(r),
      createdAt: new Date(r.created_timestamp * 1000).toISOString(),
    }
  })

  return Response.json({ orders, count: data.count })
}
