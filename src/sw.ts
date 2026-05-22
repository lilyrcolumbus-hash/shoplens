/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation fallback — but never swallow /api/* (OAuth redirects need network).
const navHandler = createHandlerBoundToURL('index.html')
registerRoute(new NavigationRoute(navHandler, { denylist: [/^\/api\//] }))

// Incoming web push -> show a notification + update the home-screen icon badge.
self.addEventListener('push', (event: PushEvent) => {
  let payload: { title: string; body: string; url?: string; count?: number } = {
    title: 'ShopLens',
    body: 'New activity',
    url: '/',
  }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    if (event.data) payload.body = event.data.text()
  }
  const nav = self.navigator as WorkerNavigator & {
    setAppBadge?: (n?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icon-512.png',
        badge: '/icon-512.png',
        data: { url: payload.url ?? '/' },
      })
      // Red number badge on the app icon, set in the background (iOS 16.4+ PWA).
      if (typeof payload.count === 'number' && nav.setAppBadge) {
        if (payload.count > 0) await nav.setAppBadge(payload.count).catch(() => {})
        else await nav.clearAppBadge?.().catch(() => {})
      }
    })(),
  )
})

// Tap a notification -> focus an open tab or open the app.
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const url = (event.notification.data?.url as string) ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
