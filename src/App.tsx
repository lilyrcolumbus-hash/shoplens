import { useState } from 'react'
import { Bell } from 'lucide-react'

type Store = 'etsy' | 'amazon' | 'tiktok' | 'whatnot' | 'shopify' | 'ebay'

interface Order {
  id: string
  store: Store
  product: string
  buyer: string
  amount: number
  currency: string
  status: 'new' | 'shipped' | 'delivered'
  createdAt: string
}

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
  { id: '1', store: 'etsy', product: 'Handmade ceramic mug', buyer: 'Sarah M.', amount: 34, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString() },
  { id: '2', store: 'amazon', product: 'Wireless earbuds', buyer: 'James K.', amount: 89.99, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString() },
  { id: '3', store: 'etsy', product: 'Vintage book set', buyer: 'Emma R.', amount: 45.50, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '4', store: 'tiktok', product: 'Customized phone case', buyer: 'Lucas P.', amount: 28, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString() },
  { id: '5', store: 'shopify', product: 'Organic skincare bundle', buyer: 'Maya T.', amount: 72.00, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString() },
  { id: '6', store: 'whatnot', product: 'Limited edition poster', buyer: 'Noah D.', amount: 18.99, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '7', store: 'ebay', product: 'Retro camera', buyer: 'Olivia S.', amount: 95.00, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 45 * 60 * 1000).toISOString() },
  { id: '8', store: 'amazon', product: 'Smart home hub', buyer: 'Chris W.', amount: 79.99, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString() },
  { id: '9', store: 'etsy', product: 'Hand-painted art print', buyer: 'Jordan L.', amount: 52, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '10', store: 'tiktok', product: 'UV nail lamp', buyer: 'Zara H.', amount: 35.50, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString() },
  { id: '11', store: 'shopify', product: 'Wireless charging pad', buyer: 'Marcus J.', amount: 49.99, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '12', store: 'whatnot', product: 'Collectible figurine', buyer: 'Riley V.', amount: 62, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString() },
  { id: '13', store: 'ebay', product: 'Vintage watch', buyer: 'Sophia B.', amount: 88.50, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '14', store: 'amazon', product: 'Portable projector', buyer: 'Aiden F.', amount: 124.99, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 15 * 60 * 1000).toISOString() },
  { id: '15', store: 'etsy', product: 'Macramé wall hanging', buyer: 'Bella C.', amount: 41, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString() },
  { id: '16', store: 'tiktok', product: 'LED strip lights', buyer: 'Tyler N.', amount: 32.75, currency: 'USD', status: 'delivered', createdAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString() },
  { id: '17', store: 'shopify', product: 'Eco water bottle', buyer: 'Ivy Q.', amount: 27.00, currency: 'USD', status: 'new', createdAt: new Date(now.getTime() - 20 * 60 * 1000).toISOString() },
  { id: '18', store: 'whatnot', product: 'Mystery box', buyer: 'Xavier E.', amount: 55.99, currency: 'USD', status: 'shipped', createdAt: new Date(now.getTime() - 9 * 60 * 60 * 1000).toISOString() },
].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

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

function getStoreCount(store: Store): number {
  return MOCK_ORDERS.filter(o => o.store === store).length
}

export default function App() {
  const [filter, setFilter] = useState<Store | 'all'>('all')
  const [notifEnabled, setNotifEnabled] = useState(false)

  const filtered = filter === 'all' ? MOCK_ORDERS : MOCK_ORDERS.filter(o => o.store === filter)
  const totalRevenue = filtered.reduce((sum, o) => sum + o.amount, 0)
  const newCount = filtered.filter(o => o.status === 'new').length

  async function enableNotifications() {
    if (!('Notification' in window)) {
      alert('Notifications not supported on this device')
      return
    }
    const perm = await Notification.requestPermission()
    if (perm === 'granted') {
      setNotifEnabled(true)
      new Notification('StoreControl ready', {
        body: 'You will be notified when new orders arrive',
        badge: '/icon-512.png',
      })
    }
  }

  function testNotification() {
    if (!notifEnabled) {
      alert('Enable notifications first')
      return
    }
    new Notification('🛍️ New Etsy order', {
      body: 'Sarah M. bought "Handmade ceramic mug" for $34.00',
      badge: '/icon-512.png',
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-500 flex items-center justify-center text-white font-bold text-lg">
              S
            </div>
            <h1 className="text-2xl font-bold text-gray-900">StoreControl</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={testNotification}
              disabled={!notifEnabled}
              className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Test
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
        {/* Stats Cards */}
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

        {/* Filter Chips */}
        <div className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-full font-medium transition text-sm ${
              filter === 'all'
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            All ({MOCK_ORDERS.length})
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

        {/* Orders List */}
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
