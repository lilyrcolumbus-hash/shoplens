// Shared client for the ShopLens worker. The app is single-owner: each person runs it against
// their own worker, so the server URL and the owner key are entered once in Settings and kept
// only in this browser's localStorage (never bundled into the app).
// Every worker route except the OAuth entry points requires the owner key (worker/src/index.ts).
const WORKER_URL_STORAGE = 'shoplens_worker_url'
const OWNER_KEY_STORAGE = 'shoplens_owner_key'

const BUILD_TIME_URL: string = (import.meta.env.VITE_WORKER_URL ?? '').replace(/\/+$/, '')

export function workerUrl(): string {
  try {
    const stored = (localStorage.getItem(WORKER_URL_STORAGE) ?? '').replace(/\/+$/, '')
    if (stored) return stored
    // A build-time URL (self-hosted deployments) is copied to localStorage so that the
    // OAuth callback page, which cannot see build variables, can use it too.
    if (BUILD_TIME_URL) localStorage.setItem(WORKER_URL_STORAGE, BUILD_TIME_URL)
  } catch {
    // localStorage unavailable: fall through to the build-time value.
  }
  return BUILD_TIME_URL
}

export function setWorkerUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '')
  if (clean) localStorage.setItem(WORKER_URL_STORAGE, clean)
  else localStorage.removeItem(WORKER_URL_STORAGE)
}

export function hasServer(): boolean {
  return workerUrl() !== ''
}

export function getOwnerKey(): string {
  try {
    return localStorage.getItem(OWNER_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setOwnerKey(key: string): void {
  if (key) localStorage.setItem(OWNER_KEY_STORAGE, key)
  else localStorage.removeItem(OWNER_KEY_STORAGE)
}

export function ownerHeaders(): Record<string, string> {
  const key = getOwnerKey()
  return key ? { 'x-shoplens-key': key } : {}
}

export function workerFetch(input: string, init: RequestInit = {}): Promise<Response> {
  // An empty server URL yields a relative path; fail clearly instead of hitting the app's own host.
  if (!/^https?:\/\//.test(input)) return Promise.reject(new Error('no_server'))
  return fetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...ownerHeaders() },
  })
}
