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

// Incoming web push -> show a notification.
self.addEventListener('push', (event: PushEvent) => {
  let payload: { title: string; body: string; url?: string } = {
    title: 'ShopLens',
    body: 'New activity',
    url: '/',
  }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    if (event.data) payload.body = event.data.text()
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-512.png',
      badge: '/icon-512.png',
      data: { url: payload.url ?? '/' },
    }),
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
