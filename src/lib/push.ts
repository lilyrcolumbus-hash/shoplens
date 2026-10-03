// Web Push subscription client — talks to the shoplens-push Cloudflare Worker.
import { loadTokens } from './etsy'
import { workerUrl, workerFetch } from './worker'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return !!sub && Notification.permission === 'granted'
}

async function fetchVapidPublic(): Promise<string> {
  // The public VAPID key belongs to the worker's key pair, so ask the worker for it.
  const resp = await workerFetch(`${workerUrl()}/vapid-public`)
  if (!resp.ok) throw new Error(`Could not load the push key (HTTP ${resp.status})`)
  return ((await resp.json()) as { key: string }).key
}

export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) {
    return { ok: false, error: 'Push not supported here. On iPhone, open the app from your home screen.' }
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, error: 'Notification permission was not granted.' }
  }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(await fetchVapidPublic()) as BufferSource,
    })
  }

  const tokens = loadTokens()
  const resp = await workerFetch(`${workerUrl()}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      etsyRefreshToken: tokens?.refreshToken,
    }),
  })
  if (!resp.ok) return { ok: false, error: `Server error ${resp.status}` }
  return { ok: true }
}

export async function sendTestPush(): Promise<boolean> {
  const resp = await workerFetch(`${workerUrl()}/test`, { method: 'POST' })
  return resp.ok
}
