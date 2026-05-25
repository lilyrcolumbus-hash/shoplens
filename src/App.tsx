import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Search, Link2, Link2Off, RefreshCw, Check, ShoppingBag, ExternalLink, ChevronRight, ArrowLeft, BarChart3 } from 'lucide-react'
import {
  type Order,
  type EtsyListingsData,
  isConnected as isEtsyConnected,
  fetchEtsyOrders,
  fetchEtsyListings,
  connectEtsy,
  clearTokens,
} from './lib/etsy'
import { enablePush, isPushEnabled, sendTestPush } from './lib/push'
import { fetchAmazonOrders, fetchAmazonTraffic, fetchAmazonListings, type AmazonTraffic, type AmazonListing } from './lib/amazon'

type Store = Order['store']
type ConnState = 'connectable' | 'available' | 'api_pending' | 'no_api'

const ETSY_ORDERS_URL = 'https://www.etsy.com/your/orders/sold'

// Where each store's order manager lives — tapping a connected store opens it.
const STORE_ORDER_URLS: Partial<Record<Store, string>> = {
  etsy: 'https://www.etsy.com/your/orders/sold',
  amazon: 'https://sellercentral.amazon.com/orders-v3/',
}

const STORE_META: Record<Store, { label: string; color: string; emoji: string; conn: ConnState }> = {
  etsy:    { label: 'Etsy',    color: 'bg-orange-500/15 text-orange-300 border-orange-500/30', emoji: '🧵', conn: 'connectable' },
  amazon:  { label: 'Amazon',  color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', emoji: '📦', conn: 'api_pending' },
  tiktok:  { label: 'TikTok',  color: 'bg-pink-500/15 text-pink-300 border-pink-500/30', emoji: '🎵', conn: 'api_pending' },
}

const CONN_LABEL: Record<ConnState, string> = {
  connectable: 'Ready to connect',
  available: 'API available — not set up',
  api_pending: 'API approval pending',
  no_api: 'No public API',
}

// Animated count-up (easeOutCubic).
function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const start = performance.now()
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(target * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration])
  return value
}

function statusBadge(status: Order['status']): { icon: string; label: string; cls: string } {
  switch (status) {
    case 'unshipped': return { icon: '🟠', label: 'To ship', cls: 'text-[#ffb800]' }
    case 'shipped':   return { icon: '✅', label: 'Shipped', cls: 'text-[#00d4c8]' }
    case 'completed': return { icon: '✅', label: 'Completed', cls: 'text-[#00d4c8]' }
    case 'canceled':  return { icon: '⊘', label: 'Canceled', cls: 'text-white/40' }
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(+d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function listingState(state: string): { label: string; cls: string } {
  switch (state) {
    case 'active': return { label: 'Active', cls: 'text-[#00d4c8]' }
    case 'draft': return { label: 'Draft · not published', cls: 'text-[#ffb800]' }
    case 'sold_out': return { label: 'Sold out', cls: 'text-[#ff4757]' }
    case 'inactive': return { label: 'Inactive', cls: 'text-white/40' }
    default: return { label: state, cls: 'text-white/40' }
  }
}

// One concrete next step per Etsy product.
function etsyProductAdvice(l: { state: string; quantity: number; views: number }): string | null {
  if (l.state === 'draft') return 'Publish to start selling'
  if (l.quantity === 0) return 'Restock'
  if (l.state === 'active' && l.views > 50) return 'Gets views but few sales — improve photos, price, reviews'
  if (l.state === 'active') return 'Low visibility — improve tags/SEO, share on Pinterest'
  return null
}

// Store-level "what to do" for Etsy.
function EtsyStoreAdvice({ data }: { data: EtsyListingsData }) {
  const active = data.counts.active ?? 0
  const draft = data.counts.draft ?? 0
  const totalViews = data.listings.reduce((s, l) => s + (l.views ?? 0), 0)
  const parts: string[] = []
  parts.push(totalViews > 100
    ? 'your listings get views but few sales — improve photos, price, title keywords, and get reviews'
    : 'low visibility — improve tags/SEO and share on Pinterest')
  if (draft > 0) parts.push(`publish your ${draft} draft${draft === 1 ? '' : 's'}`)
  if (active < 5) parts.push('add more products to widen your reach')
  return (
    <div className="glass p-4 mb-3 border-l-2 border-[#ffb800]/60">
      <p className="text-sm text-white/80">
        🟡 <span className="font-semibold">Conversion is your focus:</span> {parts.join('; ')}.
      </p>
    </div>
  )
}

// Etsy listings — status, stock, price, views, favorites. Real data from the worker.
function EtsyListingsSection() {
  const [data, setData] = useState<EtsyListingsData | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    fetchEtsyListings().then(setData).catch(() => setErr(true))
  }, [])
  return (
    <div className="mt-8">
      <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Listings</p>
      {err ? (
        <div className="glass p-4"><p className="text-sm text-white/50">Couldn't load listings.</p></div>
      ) : !data ? (
        <div className="glass p-4"><div className="shimmer h-10 w-full" /></div>
      ) : (
        <>
          <EtsyStoreAdvice data={data} />
          <div className="glass p-4 mb-3 text-sm text-white/55">
            {data.counts.active ?? 0} active · {data.counts.draft ?? 0} draft · {data.counts.sold_out ?? 0} sold out
          </div>
          <div className="space-y-2">
            {data.listings.map(l => {
              const sb = listingState(l.state)
              const advice = etsyProductAdvice(l)
              return (
                <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="glass pressable p-4 block">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-white font-medium text-sm flex-1 line-clamp-2">{l.title}</p>
                    <span className="text-sm font-bold metric-gold tabular-nums shrink-0">${l.price.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-x-3 gap-y-1 mt-2 text-xs text-white/45 flex-wrap">
                    <span className={sb.cls}>● {sb.label}</span>
                    <span>{l.quantity === 0 ? '🔴 Out of stock' : `Stock ${l.quantity}`}</span>
                    <span>👁 {l.views} views</span>
                    <span>♡ {l.numFavorers}</span>
                  </div>
                  {advice && <p className="text-xs text-[#ffb800] mt-1.5">→ {advice}</p>}
                </a>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function amazonListingState(status: string): { label: string; cls: string } {
  const s = (status || '').toLowerCase()
  if (s === 'active') return { label: 'Active', cls: 'text-[#00d4c8]' }
  if (s === 'inactive') return { label: 'Inactive', cls: 'text-[#ff4757]' }
  if (s.includes('incomplete')) return { label: 'Incomplete', cls: 'text-[#ffb800]' }
  return { label: status || 'Unknown', cls: 'text-white/40' }
}

// One concrete next step per Amazon product, from its real signals.
function amazonProductAdvice(l: AmazonListing): string | null {
  const s = (l.status || '').toLowerCase()
  if (s !== 'active') return 'Not active — fix the listing to make it sellable'
  if (l.quantity === 0) return 'Out of stock — restock'
  const sess = l.sessions ?? 0
  if (sess < 3) return 'Almost no traffic — add keywords to the title / run ads'
  if ((l.conversionPct ?? 0) < 5) return 'Visited but not converting — improve main image, price, reviews'
  return null
}

// Store-level "what to do" for Amazon, from the aggregate of all listings.
function AmazonStoreAdvice({ listings }: { listings: AmazonListing[] }) {
  const totalSessions = listings.reduce((s, l) => s + (l.sessions ?? 0), 0)
  const oos = listings.filter(l => l.quantity === 0).length
  const trafficLow = totalSessions < 60 // < ~2 visits/day across the whole shop
  return (
    <div className={`glass p-4 mb-3 border-l-2 ${trafficLow ? 'border-[#ff4757]/60' : 'border-[#ffb800]/60'}`}>
      <p className="text-sm text-white/80">
        {trafficLow ? '🔴 ' : '🟡 '}
        <span className="font-semibold">
          {trafficLow ? 'Traffic is your bottleneck.' : 'Conversion is your focus.'}
        </span>{' '}
        {trafficLow
          ? `${listings.length} products but only ~${totalSessions} visits in 30 days. Biggest lever: Amazon Ads + keyword-rich titles — not more products.`
          : `You get visits but few sales. Improve main images, price, bullet points and reviews.`}
        {oos > 0 ? ` ${oos} out of stock — restock those first.` : ''}
      </p>
    </div>
  )
}

// Amazon listings — status, stock, price. Real data from the Merchant Listings report.
function AmazonListingsSection() {
  const [data, setData] = useState<AmazonListing[] | 'pending' | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    fetchAmazonListings().then(setData).catch(() => setErr(true))
  }, [])
  return (
    <div className="mt-8">
      <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Listings</p>
      {err ? (
        <div className="glass p-4"><p className="text-sm text-white/50">Couldn't load listings.</p></div>
      ) : data === null ? (
        <div className="glass p-4"><div className="shimmer h-10 w-full" /></div>
      ) : data === 'pending' ? (
        <div className="glass p-4"><p className="text-sm text-white/55">Generating your Amazon listings report… this takes a few minutes the first time. Reopen shortly.</p></div>
      ) : data.length === 0 ? (
        <div className="glass p-4"><p className="text-sm text-white/50">No listings found.</p></div>
      ) : (
        <>
          <AmazonStoreAdvice listings={data} />
          <div className="glass p-4 mb-3 text-sm text-white/55">{data.length} listing{data.length === 1 ? '' : 's'}</div>
          <div className="space-y-2">
            {data.map(l => {
              const sb = amazonListingState(l.status)
              const advice = amazonProductAdvice(l)
              return (
                <a key={l.sku || l.asin} href={l.url || undefined} target="_blank" rel="noopener noreferrer" className="glass pressable p-4 block">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-white font-medium text-sm flex-1 line-clamp-2">{l.title || l.sku}</p>
                    {l.price > 0 && <span className="text-sm font-bold metric-gold tabular-nums shrink-0">${l.price.toFixed(2)}</span>}
                  </div>
                  <div className="flex items-center gap-x-3 gap-y-1 mt-2 text-xs text-white/45 flex-wrap">
                    <span className={sb.cls}>● {sb.label}</span>
                    <span>{l.quantity === 0 ? '🔴 Out of stock' : `Stock ${l.quantity}`}</span>
                    {typeof l.sessions === 'number' && <span>👁 {l.sessions} sessions</span>}
                    {typeof l.conversionPct === 'number' && (l.sessions ?? 0) > 0 && <span>{l.conversionPct.toFixed(1)}% conv</span>}
                  </div>
                  {advice && <p className="text-xs text-[#ffb800] mt-1.5">→ {advice}</p>}
                </a>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// In-app per-store dashboard — real orders for the tapped store, no mock data.
function StoreDashboard({ store, orders, onBack }: { store: Store; orders: Order[]; onBack: () => void }) {
  const meta = STORE_META[store]
  const orderUrl = STORE_ORDER_URLS[store]
  const toShip = orders.filter(o => o.status === 'unshipped').length
  const sorted = [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  return (
    <div className="animate-slide-up">
      <button
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white active:scale-95 transition"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-3 mb-1">
        <span className="text-3xl">{meta.emoji}</span>
        <h2 className="text-2xl font-bold text-white">{meta.label}</h2>
      </div>
      <p className="text-white/45 mb-6">
        {toShip > 0 ? `${toShip} order${toShip === 1 ? '' : 's'} to ship` : 'No orders to ship right now'}
      </p>

      {sorted.length === 0 ? (
        <div className="glass p-10 text-center mb-6">
          <p className="text-white/50">No orders yet.</p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {sorted.map(o => {
            const st = statusBadge(o.status)
            return (
              <div key={o.id} className="glass p-4 flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">{st.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium line-clamp-2">{o.product}</p>
                  <p className="text-sm text-white/50 mt-0.5">
                    {o.buyer} · ${o.amount.toFixed(2)}
                    {o.currency && o.currency !== 'USD' ? ` ${o.currency}` : ''} ·{' '}
                    <span className={st.cls}>{st.label}</span>
                  </p>
                </div>
                {fmtDate(o.createdAt) && (
                  <span className="text-xs text-white/35 whitespace-nowrap mt-0.5">{fmtDate(o.createdAt)}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {store === 'etsy' && <EtsyListingsSection />}
      {store === 'amazon' && <AmazonListingsSection />}

      {orderUrl && (
        <a
          href={orderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 w-full px-5 py-3 rounded-xl font-semibold text-black bg-gradient-to-r from-[#ffb800] to-[#f5a623] active:scale-95 transition inline-flex items-center justify-center gap-2"
        >
          Open {meta.label} order manager <ExternalLink size={16} />
        </a>
      )}
    </div>
  )
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount)
  } catch {
    return `${(currency || '').trim()} ${amount.toFixed(2)}`.trim()
  }
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur > 0 ? 100 : null
  return Math.round(((cur - prev) / prev) * 100)
}

function Chip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] text-white/40">— no data</span>
  const up = pct >= 0
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${up ? 'bg-[#00e676]/15 text-[#00e676]' : 'bg-[#ff4757]/15 text-[#ff4757]'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

function daysSinceLastSale(orders: Order[]): number | null {
  const ts = orders.map(o => +new Date(o.createdAt)).filter(n => !isNaN(n))
  if (!ts.length) return null
  return Math.floor((Date.now() - Math.max(...ts)) / 86400000)
}

// Traffic-light health from recency of the last sale (real signal we have today).
function health(daysSince: number | null): { dot: string; label: string } {
  if (daysSince === null) return { dot: '🔴', label: 'No sales yet' }
  if (daysSince <= 7) return { dot: '🟢', label: `Last sale ${daysSince}d ago` }
  if (daysSince <= 21) return { dot: '🟡', label: `Last sale ${daysSince}d ago` }
  return { dot: '🔴', label: `Last sale ${daysSince}d ago` }
}

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// Amazon Sales & Traffic diagnosis — answers "why am I not selling?" from real SP-API data.
function AmazonTrafficSection({ traffic }: { traffic: AmazonTraffic | 'pending' | null }) {
  if (traffic === null) return null
  if (traffic === 'pending') {
    return (
      <>
        <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">📦 Amazon · Traffic &amp; Conversion</p>
        <div className="glass p-4 mb-6">
          <p className="text-sm text-white/55">Generating your Amazon traffic report… this takes a few minutes the first time. Reopen Performance shortly.</p>
        </div>
      </>
    )
  }
  const t = traffic.totals
  const conv = t.conversionPct
  const perDay = t.sessions / Math.max(1, traffic.rangeDays)
  let dot = '🟢'
  let diag = ''
  if (t.sessions === 0) {
    dot = '🔴'
    diag = 'No traffic: nobody viewed your Amazon listings in this period. The bottleneck is visibility — getting found (ads, keywords, more listings).'
  } else if (perDay < 2 && conv >= 5) {
    dot = '🔴'
    diag = `Traffic problem, not conversion: only ${t.sessions} visits in ${traffic.rangeDays} days — but ${conv.toFixed(1)}% of visitors buy, which is healthy. Your listings work; you need more eyes on them (ads, keywords, more products).`
  } else if (conv < 3) {
    dot = '🟡'
    diag = `Conversion problem: people visit (${t.sessions}) but few buy (${conv.toFixed(1)}%). Look at price, main image, reviews, and Buy Box.`
  } else {
    dot = '🟢'
    diag = `${t.sessions} visits and ${conv.toFixed(1)}% conversion in ${traffic.rangeDays} days — both reasonable. Grow by scaling traffic.`
  }
  const cell = (label: string, value: string, sub?: string) => (
    <div className="glass p-4">
      <p className="text-xs text-white/40 mb-1">{label}</p>
      <p className="text-lg font-bold text-white tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-white/30 mt-0.5">{sub}</p>}
    </div>
  )
  return (
    <>
      <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">📦 Amazon · Traffic &amp; Conversion</p>
      <div className="glass p-4 mb-3 flex gap-3 items-start">
        <span className="text-xl leading-none">{dot}</span>
        <p className="text-sm text-white/75">{diag}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        {cell('Visits (sessions)', String(t.sessions), `${traffic.rangeDays}d · ~${perDay.toFixed(1)}/day`)}
        {cell('Conversion', `${conv.toFixed(1)}%`, 'visitors who bought')}
        {cell('Page views', String(t.pageViews))}
        {cell('Buy Box', `${t.buyBoxPct.toFixed(0)}%`)}
      </div>
      <p className="text-[10px] text-white/30 mb-6">Updated {timeAgo(traffic.updatedAt)} · last {traffic.rangeDays} days (US marketplace)</p>
    </>
  )
}

// Performance analytics from real orders. Revenue is grouped by currency (Amazon spans
// MX/CA/BR/US marketplaces) — we never sum across currencies; we show the primary one.
function PerformanceView({ orders, traffic, onBack }: { orders: Order[]; traffic: AmazonTraffic | 'pending' | null; onBack: () => void }) {
  const active = orders.filter(o => o.status !== 'canceled')

  const revByCcy = new Map<string, number>()
  const cntByCcy = new Map<string, number>()
  for (const o of active) {
    const c = o.currency || 'USD'
    revByCcy.set(c, (revByCcy.get(c) ?? 0) + o.amount)
    cntByCcy.set(c, (cntByCcy.get(c) ?? 0) + 1)
  }
  const currencies = [...revByCcy.entries()].sort((a, b) => b[1] - a[1])
  const primaryCcy = currencies[0]?.[0] ?? 'USD'
  const primaryRev = revByCcy.get(primaryCcy) ?? 0
  const primaryCount = cntByCcy.get(primaryCcy) ?? 0
  const aov = primaryCount ? primaryRev / primaryCount : 0

  // This week vs last week (primary currency for revenue, all orders for count).
  const DAY = 86400000, now = Date.now()
  const inRange = (o: Order, a: number, b: number) => { const t = +new Date(o.createdAt); return t >= a && t < b }
  const wkRev = (a: number, b: number) =>
    active.filter(o => (o.currency || 'USD') === primaryCcy && inRange(o, a, b)).reduce((s, o) => s + o.amount, 0)
  const wkCnt = (a: number, b: number) => active.filter(o => inRange(o, a, b)).length
  const thisRev = wkRev(now - 7 * DAY, now + DAY), prevRev = wkRev(now - 14 * DAY, now - 7 * DAY)
  const thisCnt = wkCnt(now - 7 * DAY, now + DAY), prevCnt = wkCnt(now - 14 * DAY, now - 7 * DAY)

  const stores: Store[] = ['etsy', 'amazon']
  const overall = health(daysSinceLastSale(active))

  // 14-day revenue chart, primary currency.
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const buckets = Array.from({ length: 14 }, (_, k) => {
    const d = new Date(today); d.setDate(today.getDate() - (13 - k))
    return { key: d.toDateString(), label: d.toLocaleDateString('en-US', { day: 'numeric' }), value: 0 }
  })
  const idx = new Map(buckets.map((b, i) => [b.key, i]))
  for (const o of active) {
    if ((o.currency || 'USD') !== primaryCcy) continue
    const d = new Date(o.createdAt); d.setHours(0, 0, 0, 0)
    const i = idx.get(d.toDateString()); if (i !== undefined) buckets[i].value += o.amount
  }
  const max = Math.max(1, ...buckets.map(b => b.value))

  return (
    <div className="animate-slide-up">
      <button onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white active:scale-95 transition">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-3 mb-1">
        <span className="text-3xl">📊</span>
        <h2 className="text-2xl font-bold text-white">Performance</h2>
      </div>
      <p className="text-white/45 mb-6">Recent orders (Etsy + Amazon) · revenue in {primaryCcy}</p>

      <AmazonTrafficSection traffic={traffic} />

      {active.length === 0 ? (
        <div className="glass p-10 text-center"><p className="text-white/50">No orders to analyze yet.</p></div>
      ) : (
        <>
          {/* Store health — the diagnosis */}
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Health</p>
          <div className="glass p-4 mb-3 flex items-center justify-between">
            <span className="text-sm text-white/60">Overall</span>
            <span className="text-sm text-white flex items-center gap-2">{overall.dot} {overall.label}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {stores.map(s => {
              const list = active.filter(o => o.store === s)
              const h = health(daysSinceLastSale(list))
              return (
                <div key={s} className="glass p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg">{STORE_META[s].emoji}</span>
                    <span className="font-semibold text-white text-sm">{STORE_META[s].label}</span>
                  </div>
                  <p className="text-sm flex items-center gap-1.5">
                    <span>{h.dot}</span>
                    <span className="text-white/55 text-xs">{list.length === 0 ? 'No sales yet' : h.label}</span>
                  </p>
                </div>
              )
            })}
          </div>

          {/* Key metrics — stacked rows (no clipping on mobile) */}
          <div className="space-y-2 mb-3">
            <div className="glass p-4 flex items-center justify-between">
              <span className="text-white/55">Revenue</span>
              <span className="text-lg font-bold metric-gold tabular-nums">{money(primaryRev, primaryCcy)}</span>
            </div>
            <div className="glass p-4 flex items-center justify-between">
              <span className="text-white/55">Orders</span>
              <span className="text-lg font-bold text-white tabular-nums">{active.length}</span>
            </div>
            <div className="glass p-4 flex items-center justify-between">
              <span className="text-white/55">Avg order</span>
              <span className="text-lg font-bold text-white tabular-nums">{money(aov, primaryCcy)}</span>
            </div>
          </div>
          {currencies.length > 1 ? (
            <p className="text-xs text-white/40 mb-6">Other currencies: {currencies.slice(1).map(([c, v]) => money(v, c)).join(', ')}</p>
          ) : (
            <div className="mb-6" />
          )}

          {/* This week vs last week */}
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">This week vs last</p>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="glass p-4">
              <p className="text-xs text-white/40 mb-1">Revenue (7d)</p>
              <p className="text-lg font-bold metric-gold tabular-nums mb-2">{money(thisRev, primaryCcy)}</p>
              <Chip pct={pctChange(thisRev, prevRev)} />
              <p className="text-[10px] text-white/30 mt-1.5">vs {money(prevRev, primaryCcy)} last wk</p>
            </div>
            <div className="glass p-4">
              <p className="text-xs text-white/40 mb-1">Orders (7d)</p>
              <p className="text-lg font-bold text-white tabular-nums mb-2">{thisCnt}</p>
              <Chip pct={pctChange(thisCnt, prevCnt)} />
              <p className="text-[10px] text-white/30 mt-1.5">vs {prevCnt} last wk</p>
            </div>
          </div>

          {/* Revenue by store (overflow-safe) */}
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Revenue by store ({primaryCcy})</p>
          <div className="space-y-2 mb-6">
            {stores.map(store => {
              const list = active.filter(o => o.store === store && (o.currency || 'USD') === primaryCcy)
              const rev = list.reduce((s, o) => s + o.amount, 0)
              return (
                <div key={store} className="glass p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl shrink-0">{STORE_META[store].emoji}</span>
                    <span className="font-semibold text-white truncate">{STORE_META[store].label}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold metric-gold tabular-nums">{money(rev, primaryCcy)}</p>
                    <p className="text-xs text-white/40">{list.length} order{list.length === 1 ? '' : 's'}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 14-day chart (secondary) */}
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Revenue · last 14 days ({primaryCcy})</p>
          <div className="glass p-4">
            <div className="flex items-end gap-1 h-32">
              {buckets.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full min-w-0" title={`${b.label}: ${money(b.value, primaryCcy)}`}>
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${b.value > 0 ? Math.max(10, (b.value / max) * 100) : 3}%`,
                      background: b.value > 0 ? 'linear-gradient(to top, #ffb800, #00d4c8)' : 'rgba(255,255,255,0.07)',
                    }}
                  />
                  <span className="text-[9px] text-white/30">{i % 3 === 0 ? b.label : ''}</span>
                </div>
              ))}
            </div>
            {buckets.every(b => b.value === 0) && (
              <p className="text-xs text-white/30 text-center mt-3">No revenue in the last 14 days.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function App() {
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [etsyConnected, setEtsyConnected] = useState<boolean>(() => isEtsyConnected())
  const [etsyOrders, setEtsyOrders] = useState<Order[]>([])
  const [amazonConnected, setAmazonConnected] = useState(false)
  const [amazonOrders, setAmazonOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedStore, setSelectedStore] = useState<Store | null>(null)
  const [showPerf, setShowPerf] = useState(false)
  const [amazonTraffic, setAmazonTraffic] = useState<AmazonTraffic | 'pending' | null>(null)
  const prevOrderIds = useRef<Set<string>>(new Set())

  const loadEtsy = useCallback(async (notifyOnNew = false) => {
    if (!isEtsyConnected()) {
      setEtsyOrders([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const orders = await fetchEtsyOrders()
      if (notifyOnNew && prevOrderIds.current.size > 0) {
        const newOnes = orders.filter(o => !prevOrderIds.current.has(o.id))
        for (const order of newOnes) {
          if (Notification.permission === 'granted') {
            new Notification('🧵 New Etsy order', {
              body: `${order.buyer} bought "${order.product}" for $${order.amount.toFixed(2)}`,
              badge: '/icon-512.png',
            })
          }
        }
      }
      prevOrderIds.current = new Set(orders.map(o => o.id))
      setEtsyOrders(orders)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setError(msg)
      if (msg === 'not_connected') {
        setEtsyConnected(false)
        clearTokens()
      }
    } finally {
      setLoading(false)
      setHasLoaded(true)
    }
  }, [])

  useEffect(() => {
    loadEtsy(false)
    const interval = setInterval(() => loadEtsy(true), 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadEtsy])

  useEffect(() => {
    function onFocus() {
      const connected = isEtsyConnected()
      if (connected !== etsyConnected) {
        setEtsyConnected(connected)
        if (connected) loadEtsy(false)
      } else if (connected) {
        loadEtsy(false)
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [etsyConnected, loadEtsy])

  const loadAmazon = useCallback(async () => {
    try {
      const orders = await fetchAmazonOrders()
      setAmazonOrders(orders)
      setAmazonConnected(true)
    } catch {
      setAmazonConnected(false)
    }
  }, [])

  useEffect(() => {
    loadAmazon()
    const interval = setInterval(loadAmazon, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadAmazon])

  useEffect(() => {
    fetchAmazonTraffic().then(setAmazonTraffic).catch(() => {})
  }, [])

  useEffect(() => {
    isPushEnabled().then(setNotifEnabled)
  }, [])

  // Orders awaiting fulfillment = "new orders" the user must act on.
  const allOrders = [...etsyOrders, ...amazonOrders]
  const newCount = allOrders.filter(o => o.status === 'unshipped').length
  const anyConnected = etsyConnected || amazonConnected
  const animatedCount = Math.round(useCountUp(newCount))

  // Mirror the count onto the home-screen app icon (red badge), like Mail/WhatsApp.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (newCount > 0) nav.setAppBadge?.(newCount).catch(() => {})
    else nav.clearAppBadge?.().catch(() => {})
  }, [newCount])

  async function handleEnablePush() {
    if (notifEnabled) {
      const ok = await sendTestPush()
      alert(ok ? 'Test notification sent 🔔' : 'Could not send test — try again.')
      return
    }
    const res = await enablePush()
    if (res.ok) {
      setNotifEnabled(true)
      await sendTestPush()
    } else {
      alert(res.error ?? 'Could not enable notifications')
    }
  }

  function handleDisconnectEtsy() {
    if (confirm('Disconnect Etsy? You will need to re-authorize to fetch orders again.')) {
      clearTokens()
      setEtsyConnected(false)
      setEtsyOrders([])
      prevOrderIds.current = new Set()
    }
  }

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-50 border-b border-white/[0.06]"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          background: 'rgba(8,8,8,0.7)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        }}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-black bg-gradient-to-br from-[#ffb800] to-[#00d4c8]">
              <Search size={22} strokeWidth={2.75} />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">ShopLens</h1>
          </div>
          <div className="flex items-center gap-2">
            {anyConnected && (
              <button
                onClick={() => { setSelectedStore(null); setShowPerf(true) }}
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.06] text-white/70 hover:bg-white/10 active:scale-95 transition"
                title="Performance"
              >
                <BarChart3 size={20} />
              </button>
            )}
            <button
              onClick={() => loadEtsy(false)}
              disabled={!etsyConnected || loading}
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.06] text-white/70 hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition"
              title="Refresh"
            >
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleEnablePush}
              className={`w-11 h-11 flex items-center justify-center rounded-xl active:scale-95 transition ${
                notifEnabled ? 'bg-[#00d4c8]/15 text-[#00d4c8]' : 'bg-white/[0.06] text-white/70 hover:bg-white/10'
              }`}
              title={notifEnabled ? 'Notifications on — tap to test' : 'Enable notifications'}
            >
              <Bell size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {error && (
          <div className="mb-6 glass border border-[#ff4757]/30 p-4">
            <p className="text-sm text-[#ff4757]">Error fetching orders: {error}</p>
          </div>
        )}

        {showPerf ? (
          <PerformanceView orders={allOrders} traffic={amazonTraffic} onBack={() => setShowPerf(false)} />
        ) : selectedStore ? (
          <StoreDashboard
            store={selectedStore}
            orders={selectedStore === 'etsy' ? etsyOrders : amazonOrders}
            onBack={() => setSelectedStore(null)}
          />
        ) : (
        <>
        {/* HERO: new-orders indicator (no order details — those live in each store) */}
        {!anyConnected ? (
          <div className="glass glass-glow p-10 text-center animate-slide-up mb-8">
            <ShoppingBag className="mx-auto text-white/20 mb-4" size={48} />
            <p className="text-white font-semibold text-lg mb-1">Connect your shop</p>
            <p className="text-white/45 mb-6">Connect Etsy to start tracking new orders.</p>
            <button
              onClick={connectEtsy}
              className="px-5 py-3 rounded-xl font-semibold text-black bg-gradient-to-r from-[#ffb800] to-[#f5a623] active:scale-95 transition inline-flex items-center gap-2"
            >
              <Link2 size={16} /> Connect Etsy
            </button>
          </div>
        ) : loading && !hasLoaded ? (
          <div className="glass p-10 mb-8">
            <div className="shimmer h-24 w-full" />
          </div>
        ) : newCount > 0 ? (
          <div className="glass glass-glow p-10 text-center animate-slide-up mb-8 relative overflow-visible">
            <div className="inline-flex items-center justify-center mb-4">
              <span className="relative flex items-center justify-center">
                <span className="absolute inline-flex w-20 h-20 rounded-full bg-[#00e676]/20 animate-ping" />
                <span className="relative text-7xl font-extrabold metric-gold tabular-nums">{animatedCount}</span>
              </span>
            </div>
            <p className="text-white text-xl font-semibold mb-1">
              {newCount === 1 ? 'New order to ship' : 'New orders to ship'}
            </p>
            <p className="text-white/45 mb-6">Tap below to view the details on Etsy.</p>
            <a
              href={ETSY_ORDERS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-3 rounded-xl font-semibold text-black bg-gradient-to-r from-[#ffb800] to-[#f5a623] active:scale-95 transition inline-flex items-center gap-2"
            >
              View orders on Etsy <ExternalLink size={16} />
            </a>
          </div>
        ) : (
          <div className="glass glass-glow p-10 text-center animate-slide-up mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#00d4c8]/15 flex items-center justify-center">
              <Check className="text-[#00d4c8]" size={32} strokeWidth={3} />
            </div>
            <p className="text-white text-xl font-semibold mb-1">All caught up</p>
            <p className="text-white/45 mb-6">No new orders to ship right now.</p>
            <a
              href={ETSY_ORDERS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-white/60 hover:text-white inline-flex items-center gap-1.5"
            >
              View all orders on Etsy <ExternalLink size={14} />
            </a>
          </div>
        )}

        {/* Store connections */}
        <section>
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Stores</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(Object.keys(STORE_META) as Store[]).map((store, i) => {
              const meta = STORE_META[store]
              const connected =
                (store === 'etsy' && etsyConnected) || (store === 'amazon' && amazonConnected)
              const openStore = () => {
                if (connected) setSelectedStore(store)
              }
              return (
                <div
                  key={store}
                  onClick={openStore}
                  className={`glass glass-glow pressable animate-slide-up p-4 ${
                    connected ? 'ring-1 ring-[#00d4c8]/40 cursor-pointer' : ''
                  }`}
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{meta.emoji}</span>
                    <span className="font-semibold text-white">{meta.label}</span>
                  </div>
                  {connected ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[#00d4c8]">● Connected</span>
                        {store === 'etsy' && (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              handleDisconnectEtsy()
                            }}
                            className="w-9 h-9 -mr-1 flex items-center justify-center text-white/40 hover:text-white/80 active:scale-95"
                            title="Disconnect"
                          >
                            <Link2Off size={16} />
                          </button>
                        )}
                      </div>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs text-white/40">
                        Open dashboard <ChevronRight size={12} />
                      </span>
                    </>
                  ) : meta.conn === 'connectable' ? (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        connectEtsy()
                      }}
                      className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm font-semibold text-black bg-gradient-to-r from-[#ffb800] to-[#f5a623] active:scale-95 transition flex items-center justify-center gap-1.5"
                    >
                      <Link2 size={16} /> Connect
                    </button>
                  ) : (
                    <span className="text-sm text-white/45">{CONN_LABEL[meta.conn]}</span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
        </>
        )}
      </main>
    </div>
  )
}
