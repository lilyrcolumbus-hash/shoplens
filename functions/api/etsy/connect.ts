// GET /api/etsy/connect?code_challenge=X&state=Y
// Asks the worker (which holds the user's Etsy keystring, entered in Settings) for the
// authorize URL, then redirects there. PKCE verifier is held client-side in localStorage
// (no cookies — robust on iOS Safari).

interface Env {
  SHOPLENS_WORKER_URL?: string
}

const DEFAULT_WORKER_URL = 'https://shoplens-push.lilyrcolumbus.workers.dev'

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const codeChallenge = url.searchParams.get('code_challenge')
  const state = url.searchParams.get('state')

  if (!codeChallenge || !state) {
    return new Response('Missing code_challenge or state', { status: 400 })
  }

  const redirectUri = `${url.origin}/api/etsy/callback`
  const workerUrl = env.SHOPLENS_WORKER_URL || DEFAULT_WORKER_URL
  const qs = new URLSearchParams({ code_challenge: codeChallenge, state, redirect_uri: redirectUri })

  const r = await fetch(`${workerUrl}/etsy/authorize-url?${qs}`)
  if (!r.ok) {
    const detail = await r.text()
    return new Response(`Etsy isn't connected yet — add your Etsy app credentials in Settings first.\n${detail}`, { status: 400 })
  }
  const { url: authorizeUrl } = (await r.json()) as { url: string }

  return new Response(null, { status: 302, headers: { Location: authorizeUrl } })
}
