// POST /api/etsy/token
// Body: { code: string, code_verifier: string }
// Exchanges the authorization code + PKCE verifier for access/refresh tokens.

interface Env {
  ETSY_KEYSTRING: string
  ETSY_REDIRECT_URI: string
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const body = await request.json() as { code?: string; code_verifier?: string }
  if (!body.code || !body.code_verifier) {
    return Response.json({ error: 'Missing code or code_verifier' }, { status: 400 })
  }

  const resp = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.ETSY_KEYSTRING,
      redirect_uri: env.ETSY_REDIRECT_URI,
      code: body.code,
      code_verifier: body.code_verifier,
    }),
  })

  if (!resp.ok) {
    return new Response(await resp.text(), { status: resp.status })
  }

  const tokens = await resp.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  return Response.json({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  })
}
