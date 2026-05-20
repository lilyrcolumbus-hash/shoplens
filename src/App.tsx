import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Search, Link2, Link2Off, RefreshCw, Inbox } from 'lucide-react'
import {
  type Order,
  isConnected as isEtsyConnected,
  fetchEtsyOrders,
  connectEtsy,
  clearTokens,
} from './lib/etsy'

type Store = Order['store']
type ConnState = 'connectable' | 'available' | 'api_pending' | 'no_api'

const STORE_META: Record<Store, { label: string; color: string; emoji: string; conn: ConnState }> = {
  etsy:    { label: 'Etsy',    color: 'bg-orange-500/15 text-orange-300 border-orange-500/30', emoji: '🧵', conn: 'connectable' },
  amazon:  { label: 'Amazon',  color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', emoji: '📦', conn: 'api_pending' },
  tiktok:  { label: 'TikTok',  color: 'bg-pink-500/15 text-pink-300 border-pink-500/30', emoji: '🎵', conn: 'api_pending' },
  whatnot: { label: 'Whatnot', color: 'bg-slate-500/15 text-slate-300 border-slate-500/30', emoji: '🎯', conn: 'no_api' },
  shopify: { label: 'Shopify', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', emoji: '🛍️', conn: 'available' },
}

const CONN_LABEL: Record<ConnState, string> = {
  connectable: 'Ready to connect',
  available: 'API available — not set up',
  api_pending: 'API approval pending',
  no_api: 'No public API',
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

// Animated count-up (easeOutCubic) for the revenue ticker.
function useCountUp(target: number, duration = 1200): number {
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

const STATUS_STYLE: Record<Order['status'], { label: string; cls: string; sonar?: boolean }> = {
  unshipped: { label: 'To ship', cls: 'text-[#00e676] border-[#00e676]/40 bg-[#00e676]/12', sonar: true },
  shipped:   { label: 'Shipped', cls: 'text-[#f5a623] border-[#f5a623]/40 bg-[#f5a623]/12' },
  completed: { label: 'Completed', cls: 'text-[#00d4c8] border-[#00d4c8]/40 bg-[#00d4c8]/12' },
  canceled:  { label: 'Canceled', cls: 'text-[#ff4757] border-[#ff4757]/40 bg-[#ff4757]/12' },
}

export default function App() {
  const [filter, setFilter] = useState<Store | 'all'>('all')
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [etsyConnected, setEtsyConnected] = useState<boolean>(() => isEtsyConnected())
  const [etsyOrders, setEtsyOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [etsyConnected, loadEtsy])

  // Only real data — no mocks.
  const allOrders = [...etsyOrders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  const filtered = filter === 'all' ? allOrders : allOrders.filter(o => o.store === filter)
  // Revenue excludes canceled/refunded orders — those aren't real income.
  const totalRevenue = filtered
    .filter(o => o.status !== 'canceled')
    .reduce((sum, o) => sum + o.amount, 0)
  const toShipCount = filtered.filter(o => o.status === 'unshipped').length
  const anyStoreConnected = etsyConnected
  const animatedRevenue = useCountUp(totalRevenue)

  function getStoreCount(store: Store): number {
    return allOrders.filter(o => o.store === store).length
  }

  async function enableNotifications() {
    if (!('Notification' in window)) {
      alert('Notifications not supported on this device')
      return
    }
    const perm = await Notification.requestPermission()
    if (perm === 'granted') {
      setNotifEnabled(true)
      new Notification('ShopLens ready', {
        body: 'You will be notified when new orders arrive',
        badge: '/icon-512.png',
      })
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-black bg-gradient-to-br from-[#ffb800] to-[#00d4c8]">
              <Search size={22} strokeWidth={2.75} />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">ShopLens</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadEtsy(false)}
              disabled={!etsyConnected || loading}
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.06] text-white/70 hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition"
              title="Refresh orders"
            >
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={enableNotifications}
              className={`w-11 h-11 flex items-center justify-center rounded-xl active:scale-95 transition ${
                notifEnabled ? 'bg-[#00d4c8]/15 text-[#00d4c8]' : 'bg-white/[0.06] text-white/70 hover:bg-white/10'
              }`}
              title={notifEnabled ? 'Notifications enabled' : 'Enable notifications'}
            >
              <Bell size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Store connections */}
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Stores</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(Object.keys(STORE_META) as Store[]).map((store, i) => {
              const meta = STORE_META[store]
              const connected = store === 'etsy' && etsyConnected
              return (
                <div
                  key={store}
                  className={`glass glass-glow pressable animate-slide-up p-4 ${connected ? 'ring-1 ring-[#00d4c8]/40' : ''}`}
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{meta.emoji}</span>
                    <span className="font-semibold text-white">{meta.label}</span>
                  </div>
                  {connected ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#00d4c8]">● Connected</span>
                      <button
                        onClick={handleDisconnectEtsy}
                        className="w-9 h-9 -mr-1 flex items-center justify-center text-white/40 hover:text-white/80 active:scale-95"
                        title="Disconnect"
                      >
                        <Link2Off size={16} />
                      </button>
                    </div>
                  ) : meta.conn === 'connectable' ? (
                    <button
                      onClick={connectEtsy}
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

        {error && (
          <div className="mb-6 glass border border-[#ff4757]/30 p-4">
            <p className="text-sm text-[#ff4757]">Error fetching orders: {error}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="glass glass-glow p-6 animate-slide-up" style={{ animationDelay: '120ms' }}>
            <p className="text-sm font-medium text-white/45 mb-2">Total Orders</p>
            <p className="text-4xl font-extrabold text-white tabular-nums tracking-tight">{filtered.length}</p>
          </div>
          <div className="glass glass-glow p-6 animate-slide-up" style={{ animationDelay: '190ms' }}>
            <p className="text-sm font-medium text-white/45 mb-2">To Ship</p>
            <p className="text-4xl font-extrabold tabular-nums tracking-tight text-[#00e676]">{toShipCount}</p>
          </div>
          <div className="glass glass-glow p-6 animate-slide-up" style={{ animationDelay: '260ms' }}>
            <p className="text-sm font-medium text-white/45 mb-2">Revenue</p>
            <p className="text-4xl font-extrabold metric-gold">${animatedRevenue.toFixed(2)}</p>
          </div>
        </div>

        {/* Filters */}
        {allOrders.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2.5 rounded-full font-medium transition text-sm active:scale-95 ${
                filter === 'all'
                  ? 'bg-white text-black'
                  : 'bg-white/[0.06] text-white/70 border border-white/10 hover:bg-white/10'
              }`}
            >
              All ({allOrders.length})
            </button>
            {(Object.keys(STORE_META) as Store[])
              .filter(store => getStoreCount(store) > 0)
              .map(store => (
                <button
                  key={store}
                  onClick={() => setFilter(store)}
                  className={`px-4 py-2.5 rounded-full font-medium transition text-sm flex items-center gap-1 active:scale-95 ${
                    filter === store
                      ? 'bg-white text-black'
                      : 'bg-white/[0.06] text-white/70 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  {STORE_META[store].emoji} {STORE_META[store].label}{' '}
                  <span className="text-xs opacity-60">({getStoreCount(store)})</span>
                </button>
              ))}
          </div>
        )}

        {/* Order list */}
        {!anyStoreConnected ? (
          <div className="glass glass-glow p-12 text-center">
            <Inbox className="mx-auto text-white/20 mb-4" size={48} />
            <p className="text-white font-semibold text-lg mb-1">No store connected</p>
            <p className="text-white/45 mb-6">Connect a store above to start seeing your real orders.</p>
            <button
              onClick={connectEtsy}
              className="px-5 py-3 rounded-xl font-semibold text-black bg-gradient-to-r from-[#ffb800] to-[#f5a623] active:scale-95 transition inline-flex items-center gap-2"
            >
              <Link2 size={16} /> Connect Etsy
            </button>
          </div>
        ) : loading && !hasLoaded ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="glass p-4 flex items-center gap-4">
                <div className="shimmer w-16 h-9" />
                <div className="flex-1 space-y-2">
                  <div className="shimmer h-4 w-2/3" />
                  <div className="shimmer h-3 w-1/3" />
                </div>
                <div className="shimmer h-6 w-16" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass glass-glow p-12 text-center">
            <Inbox className="mx-auto text-white/20 mb-4" size={48} />
            <p className="text-white font-semibold text-lg mb-1">No orders yet</p>
            <p className="text-white/45">
              {filter === 'all'
                ? 'Your connected store has no orders to show right now.'
                : `No ${STORE_META[filter as Store].label} orders.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((order, i) => {
              const meta = STORE_META[order.store]
              const st = STATUS_STYLE[order.status]
              return (
                <div
                  key={order.id}
                  className="glass glass-glow pressable animate-slide-up p-4 flex items-center justify-between gap-4"
                  style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`px-3 py-2 rounded-lg border ${meta.color} font-medium text-sm whitespace-nowrap`}>
                      {meta.emoji} {meta.label}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{order.product}</p>
                      <p className="text-sm text-white/45">{order.buyer}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="font-bold text-white tabular-nums">${order.amount.toFixed(2)}</p>
                      <p className="text-xs text-white/40">{formatRelativeTime(order.createdAt)}</p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${st.cls} ${st.sonar ? 'sonar' : ''}`}
                    >
                      {st.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
