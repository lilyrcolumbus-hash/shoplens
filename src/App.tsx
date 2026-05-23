import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Search, Link2, Link2Off, RefreshCw, Check, ShoppingBag, ExternalLink, ChevronRight, ArrowLeft, BarChart3 } from 'lucide-react'
import {
  type Order,
  isConnected as isEtsyConnected,
  fetchEtsyOrders,
  connectEtsy,
  clearTokens,
} from './lib/etsy'
import { enablePush, isPushEnabled, sendTestPush } from './lib/push'
import { fetchAmazonOrders } from './lib/amazon'

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
  whatnot: { label: 'Whatnot', color: 'bg-slate-500/15 text-slate-300 border-slate-500/30', emoji: '🎯', conn: 'no_api' },
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
                  <p className="text-white font-medium truncate">{o.product}</p>
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

      {orderUrl && (
        <a
          href={orderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full px-5 py-3 rounded-xl font-semibold text-black bg-gradient-to-r from-[#ffb800] to-[#f5a623] active:scale-95 transition inline-flex items-center justify-center gap-2"
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

// Performance analytics from real orders. Revenue is grouped by currency (Amazon spans
// MX/CA/BR/US marketplaces) — we never sum across currencies; we show the primary one.
function PerformanceView({ orders, onBack }: { orders: Order[]; onBack: () => void }) {
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

      {active.length === 0 ? (
        <div className="glass p-10 text-center"><p className="text-white/50">No orders to analyze yet.</p></div>
      ) : (
        <>
          {/* Store health — the diagnosis */}
          <div className="glass p-4 mb-3 flex items-center justify-between">
            <span className="text-sm text-white/60">Overall health</span>
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
            </div>
            <div className="glass p-4">
              <p className="text-xs text-white/40 mb-1">Orders (7d)</p>
              <p className="text-lg font-bold text-white tabular-nums mb-2">{thisCnt}</p>
              <Chip pct={pctChange(thisCnt, prevCnt)} />
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
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Revenue · last 14 days</p>
          <div className="glass p-4">
            <div className="flex items-end gap-1 h-24">
              {buckets.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${b.label}: ${money(b.value, primaryCcy)}`}>
                  <div className="w-full rounded-t bg-gradient-to-t from-[#ffb800] to-[#00d4c8]" style={{ height: `${Math.max(2, (b.value / max) * 100)}%`, opacity: b.value > 0 ? 1 : 0.18 }} />
                  <span className="text-[9px] text-white/30">{i % 3 === 0 ? b.label : ''}</span>
                </div>
              ))}
            </div>
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
          <PerformanceView orders={allOrders} onBack={() => setShowPerf(false)} />
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
