// Web Push subscription client — talks to the shoplens-push Cloudflare Worker.
import { loadTokens } from './etsy'
import { WORKER_URL, workerFetch } from './worker'

const VAPID_PUBLIC =
  'BMC9aGp-ivfjw0beZu1QxE5vTeQn0Qe4y8ennTAtVJKny2CcVYrnNlPapITdApgCcZ4d0BB7IqusTAA7FFz7Uyw'

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
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
    })
  }

  const tokens = loadTokens()
  const resp = await workerFetch(`${WORKER_URL}/subscribe`, {
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
  const resp = await workerFetch(`${WORKER_URL}/test`, { method: 'POST' })
  return resp.ok
}
