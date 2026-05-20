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
  etsy:    { label: 'Etsy',    color: 'bg-orange-100 text-orange-700 border-orange-200', emoji: '🧵', conn: 'connectable' },
  amazon:  { label: 'Amazon',  color: 'bg-yellow-100 text-yellow-800 border-yellow-200', emoji: '📦', conn: 'api_pending' },
  tiktok:  { label: 'TikTok',  color: 'bg-pink-100 text-pink-700 border-pink-200', emoji: '🎵', conn: 'api_pending' },
  whatnot: { label: 'Whatnot', color: 'bg-purple-100 text-purple-700 border-purple-200', emoji: '🎯', conn: 'no_api' },
  shopify: { label: 'Shopify', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', emoji: '🛍️', conn: 'available' },
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <header
        className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-500 flex items-center justify-center text-white">
              <Search size={22} strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">ShopLens</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadEtsy(false)}
              disabled={!etsyConnected || loading}
              className="w-11 h-11 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title="Refresh orders"
            >
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={enableNotifications}
              className={`w-11 h-11 flex items-center justify-center rounded-lg active:scale-95 transition ${
                notifEnabled ? 'bg-sky-100 text-sky-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title={notifEnabled ? 'Notifications enabled' : 'Enable notifications'}
            >
              <Bell size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Store connections — honest status per store */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Stores</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(Object.keys(STORE_META) as Store[]).map(store => {
              const meta = STORE_META[store]
              const connected = store === 'etsy' && etsyConnected
              return (
                <div
                  key={store}
                  className={`rounded-2xl border p-4 bg-white ${connected ? 'border-emerald-300' : 'border-gray-200'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{meta.emoji}</span>
                    <span className="font-semibold text-gray-900">{meta.label}</span>
                  </div>
                  {connected ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-emerald-600">● Connected</span>
                      <button
                        onClick={handleDisconnectEtsy}
                        className="w-9 h-9 -mr-1 flex items-center justify-center text-gray-500 hover:text-gray-700 active:scale-95"
                        title="Disconnect"
                      >
                        <Link2Off size={16} />
                      </button>
                    </div>
                  ) : meta.conn === 'connectable' ? (
                    <button
                      onClick={connectEtsy}
                      className="w-full mt-1 px-3 py-2.5 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 active:scale-95 transition flex items-center justify-center gap-1.5"
                    >
                      <Link2 size={16} /> Connect
                    </button>
                  ) : (
                    <span className="text-sm text-gray-500">{CONN_LABEL[meta.conn]}</span>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-sm text-red-800">Error fetching orders: {error}</p>
          </div>
        )}

        {/* Stats — real data only */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <p className="text-sm font-medium text-gray-600 mb-2">Total Orders</p>
            <p className="text-3xl font-bold text-gray-900">{filtered.length}</p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <p className="text-sm font-medium text-gray-600 mb-2">To Ship</p>
            <p className="text-3xl font-bold text-orange-600">{toShipCount}</p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <p className="text-sm font-medium text-gray-600 mb-2">Revenue</p>
            <p className="text-3xl font-bold text-gray-900">${totalRevenue.toFixed(2)}</p>
          </div>
        </div>

        {/* Filters — only show when there are orders */}
        {allOrders.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2.5 rounded-full font-medium transition text-sm active:scale-95 ${
                filter === 'all' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
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
                    filter === store ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {STORE_META[store].emoji} {STORE_META[store].label}{' '}
                  <span className="text-xs opacity-70">({getStoreCount(store)})</span>
                </button>
              ))}
          </div>
        )}

        {/* Order list with honest empty states */}
        {!anyStoreConnected ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
            <Inbox className="mx-auto text-gray-300 mb-4" size={48} />
            <p className="text-gray-900 font-semibold text-lg mb-1">No store connected</p>
            <p className="text-gray-500 mb-6">Connect a store above to start seeing your real orders.</p>
            <button
              onClick={connectEtsy}
              className="px-5 py-2.5 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition inline-flex items-center gap-2"
            >
              <Link2 size={16} /> Connect Etsy
            </button>
          </div>
        ) : loading && !hasLoaded ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
            <RefreshCw className="mx-auto text-gray-300 mb-4 animate-spin" size={40} />
            <p className="text-gray-500">Loading your orders...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
            <Inbox className="mx-auto text-gray-300 mb-4" size={48} />
            <p className="text-gray-900 font-semibold text-lg mb-1">No orders yet</p>
            <p className="text-gray-500">
              {filter === 'all'
                ? 'Your connected store has no orders to show right now.'
                : `No ${STORE_META[filter as Store].label} orders.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(order => {
              const meta = STORE_META[order.store]
              const statusColors = {
                unshipped: 'bg-orange-100 text-orange-700 border-orange-200',
                shipped: 'bg-amber-100 text-amber-700 border-amber-200',
                completed: 'bg-green-100 text-green-700 border-green-200',
                canceled: 'bg-gray-100 text-gray-500 border-gray-200',
              }
              const statusLabels = {
                unshipped: 'To ship',
                shipped: 'Shipped',
                completed: 'Completed',
                canceled: 'Canceled',
              }
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm hover:shadow-md transition flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={`px-3 py-2 rounded-lg border ${meta.color} font-medium text-sm whitespace-nowrap`}>
                      {meta.emoji} {meta.label}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{order.product}</p>
                      <p className="text-sm text-gray-600">{order.buyer}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-bold text-gray-900">${order.amount.toFixed(2)}</p>
                      <p className="text-xs text-gray-600">{formatRelativeTime(order.createdAt)}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${statusColors[order.status]}`}>
                      {statusLabels[order.status]}
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
