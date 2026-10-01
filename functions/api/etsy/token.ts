// POST /api/etsy/token
// Body: { code: string, code_verifier: string }
// Proxies the PKCE code exchange to the worker, which holds the user's Etsy keystring
// (entered in Settings) and performs the actual exchange with Etsy.

interface Env {
  SHOPLENS_WORKER_URL?: string
}

const DEFAULT_WORKER_URL = 'https://shoplens-push.lilyrcolumbus.workers.dev'

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const body = (await request.json()) as { code?: string; code_verifier?: string }
  if (!body.code || !body.code_verifier) {
    return Response.json({ error: 'Missing code or code_verifier' }, { status: 400 })
  }

  const url = new URL(request.url)
  const redirectUri = `${url.origin}/api/etsy/callback`
  const workerUrl = env.SHOPLENS_WORKER_URL || DEFAULT_WORKER_URL

  const resp = await fetch(`${workerUrl}/etsy/token-exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: body.code, codeVerifier: body.code_verifier, redirectUri }),
  })

  if (!resp.ok) {
    return new Response(await resp.text(), { status: resp.status })
  }

  const tokens = (await resp.json()) as { accessToken: string; refreshToken: string; expiresAt: number }
  return Response.json(tokens)
}
