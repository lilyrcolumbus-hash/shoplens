import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Search, Link2, Link2Off, RefreshCw } from 'lucide-react'
import {
  type Order,
  isConnected as isEtsyConnected,
  fetchEtsyOrders,
  connectEtsy,
  clearTokens,
} from './lib/etsy'

type Store = Order['store']

const STORE_META: Record<Store, { label: string; color: string; emoji: string }> = {
  etsy:    { label: 'Etsy',    color: 'bg-orange-100 text-orange-700 border-orange-200', emoji: '🧵' },
  amazon:  { label: 'Amazon',  color: 'bg-yellow-100 text-yellow-800 border-yellow-200', emoji: '📦' },
  tiktok:  { label: 'TikTok',  color: 'bg-pink-100 text-pink-700 border-pink-200', emoji: '🎵' },
  whatnot: { label: 'Whatnot', color: 'bg-purple-100 text-purple-700 border-purple-200', emoji: '🎯' },
  shopify: { label: 'Shopify', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', emoji: '🛍️' },
  ebay:    { label: 'eBay',    color: 'bg-blue-100 text-blue-700 border-blue-200', emoji: '🔵' },
}

const now = new Date()
const MOCK_ORDERS: Order[] = [
  // Non-Etsy mock orders (placeholder until APIs of other stores are connected)
  { id: '2', store: 'amazon', product: 'Wireless earbuds', buyer: 'James K.', amount: 89.99, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString() },
  { id: '4', store: 'tiktok', product: 'Customized phone case', buyer: 'Lucas P.', amount: 28, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString() },
  { id: '5', store: 'shopify', product: 'Organic skincare bundle', buyer: 'Maya T.', amount: 72.00, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString() },
  { id: '6', store: 'whatnot', product: 'Limited edition poster', buyer: 'Noah D.', amount: 18.99, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '7', store: 'ebay', product: 'Retro camera', buyer: 'Olivia S.', amount: 95.00, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 45 * 60 * 1000).toISOString() },
  { id: '8', store: 'amazon', product: 'Smart home hub', buyer: 'Chris W.', amount: 79.99, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString() },
  { id: '10', store: 'tiktok', product: 'UV nail lamp', buyer: 'Zara H.', amount: 35.50, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString() },
  { id: '11', store: 'shopify', product: 'Wireless charging pad', buyer: 'Marcus J.', amount: 49.99, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '12', store: 'whatnot', product: 'Collectible figurine', buyer: 'Riley V.', amount: 62, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString() },
  { id: '13', store: 'ebay', product: 'Vintage watch', buyer: 'Sophia B.', amount: 88.50, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString() },
]

const ETSY_FALLBACK_MOCKS: Order[] = [
  { id: 'mock-etsy-1', store: 'etsy', product: '(demo) Handmade ceramic mug', buyer: 'Sarah M.', amount: 34, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString() },
  { id: 'mock-etsy-2', store: 'etsy', product: '(demo) Vintage book set', buyer: 'Emma R.', amount: 45.50, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString() },
  { id: 'mock-etsy-3', store: 'etsy', product: '(demo) Hand-painted art print', buyer: 'Jordan L.', amount: 52, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString() },
]

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
      // Detect new orders (not in previous set) and fire notifications
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
    }
  }, [])

  useEffect(() => {
    loadEtsy(false)
    const interval = setInterval(() => loadEtsy(true), 5 * 60 * 1000) // poll every 5 min
    return () => clearInterval(interval)
  }, [loadEtsy])

  // Re-check connection state when window regains focus (e.g., after OAuth redirect)
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

  const allOrders = [
    ...(etsyConnected ? etsyOrders : ETSY_FALLBACK_MOCKS),
    ...MOCK_ORDERS,
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const filtered = filter === 'all' ? allOrders : allOrders.filter(o => o.store === filter)
  const totalRevenue = filtered.reduce((sum, o) => sum + o.amount, 0)
  const newCount = filtered.filter(o => o.status === 'new').length

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
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
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
              className="p-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
              title="Refresh Etsy orders"
            >
              <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={enableNotifications}
              className={`p-2 rounded-lg transition ${
                notifEnabled
                  ? 'bg-sky-100 text-sky-600'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title={notifEnabled ? 'Notifications enabled' : 'Enable notifications'}
            >
              <Bell size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Etsy connection banner */}
        {!etsyConnected ? (
          <div className="mb-6 bg-orange-50 border border-orange-200 rounded-2xl p-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-orange-900">Connect your Etsy shop</p>
              <p className="text-sm text-orange-700 mt-1">
                Showing demo data. Connect <span className="font-medium">LaPappa</span> to see real orders.
              </p>
            </div>
            <button
              onClick={connectEtsy}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition flex items-center gap-2 whitespace-nowrap"
            >
              <Link2 size={16} /> Connect Etsy
            </button>
          </div>
        ) : (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between gap-4">
            <p className="text-sm text-emerald-800">
              <span className="font-semibold">✓ Etsy connected</span> — {etsyOrders.length} order{etsyOrders.length === 1 ? '' : 's'} from LaPappa
              {loading && ' (refreshing...)'}
            </p>
            <button
              onClick={handleDisconnectEtsy}
              className="text-sm text-emerald-700 hover:text-emerald-900 flex items-center gap-1"
            >
              <Link2Off size={14} /> Disconnect
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-sm text-red-800">Error fetching Etsy: {error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <p className="text-sm font-medium text-gray-600 mb-2">Total Orders</p>
            <p className="text-3xl font-bold text-gray-900">{filtered.length}</p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <p className="text-sm font-medium text-gray-600 mb-2">New Orders</p>
            <p className="text-3xl font-bold text-orange-600">{newCount}</p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
            <p className="text-sm font-medium text-gray-600 mb-2">Revenue</p>
            <p className="text-3xl font-bold text-gray-900">${totalRevenue.toFixed(2)}</p>
          </div>
        </div>

        <div className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-full font-medium transition text-sm ${
              filter === 'all'
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            All ({allOrders.length})
          </button>
          {(Object.keys(STORE_META) as Store[]).map(store => (
            <button
              key={store}
              onClick={() => setFilter(store)}
              className={`px-4 py-2 rounded-full font-medium transition text-sm flex items-center gap-1 ${
                filter === store
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {STORE_META[store].emoji} {STORE_META[store].label} <span className="text-xs opacity-70">({getStoreCount(store)})</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
            <p className="text-gray-500 text-lg">No orders found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(order => {
              const meta = STORE_META[order.store]
              const statusColors = {
                new: 'bg-blue-100 text-blue-700 border-blue-200',
                shipped: 'bg-amber-100 text-amber-700 border-amber-200',
                delivered: 'bg-green-100 text-green-700 border-green-200',
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
                      <p className="text-xs text-gray-500">{formatRelativeTime(order.createdAt)}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${statusColors[order.status]}`}>
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
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
