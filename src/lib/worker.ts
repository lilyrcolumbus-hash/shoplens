// Shared client for the ShopLens worker. Every worker route except the OAuth entry points
// requires the owner key (see worker/src/index.ts), which the owner enters once in Settings
// and is kept only in this browser's localStorage — it is never bundled into the app.
// Defaults to the maintainer's worker; anyone deploying their own copy sets VITE_WORKER_URL
// at build time (see README) instead of editing the code.
export const WORKER_URL: string =
  import.meta.env.VITE_WORKER_URL ?? 'https://shoplens-push.lilyrcolumbus.workers.dev'

const OWNER_KEY_STORAGE = 'shoplens_owner_key'

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
  return fetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...ownerHeaders() },
  })
}
