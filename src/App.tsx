import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Search, Link2, Link2Off, RefreshCw, Check, ShoppingBag, ExternalLink } from 'lucide-react'
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

export default function App() {
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [etsyConnected, setEtsyConnected] = useState<boolean>(() => isEtsyConnected())
  const [etsyOrders, setEtsyOrders] = useState<Order[]>([])
  const [amazonConnected, setAmazonConnected] = useState(false)
  const [amazonOrders, setAmazonOrders] = useState<Order[]>([])
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
              const orderUrl = STORE_ORDER_URLS[store]
              const openStore = () => {
                if (connected && orderUrl) window.open(orderUrl, '_blank', 'noopener')
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
                        View orders <ExternalLink size={11} />
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
      </main>
    </div>
  )
}
