// GET /api/tiktok/connect
// Asks the worker (which holds the user's TikTok app key + service id, entered in Settings)
// for the authorize URL, then redirects the seller to the TikTok Shop authorization screen.
// After they authorize, TikTok redirects to /api/tiktok/callback with ?code=.

interface Env {
  SHOPLENS_WORKER_URL?: string
}

const DEFAULT_WORKER_URL = 'https://shoplens-push.lilyrcolumbus.workers.dev'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const workerUrl = env.SHOPLENS_WORKER_URL || DEFAULT_WORKER_URL
  const r = await fetch(`${workerUrl}/tiktok/authorize-url`)
  if (!r.ok) {
    const detail = await r.text()
    return new Response(`TikTok isn't connected yet — add your TikTok app credentials in Settings first.\n${detail}`, { status: 400 })
  }
  const { url } = (await r.json()) as { url: string }
  return new Response(null, { status: 302, headers: { Location: url } })
}
