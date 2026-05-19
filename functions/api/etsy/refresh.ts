// POST /api/etsy/refresh
// Body: { refreshToken: string }
// Returns new access_token + refresh_token + expiresAt.

interface Env {
  ETSY_KEYSTRING: string
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const body = await request.json() as { refreshToken?: string }
  if (!body.refreshToken) {
    return Response.json({ error: 'Missing refreshToken' }, { status: 400 })
  }

  const resp = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: env.ETSY_KEYSTRING,
      refresh_token: body.refreshToken,
    }),
  })

  if (!resp.ok) {
    return Response.json({ error: `refresh_failed_${resp.status}`, detail: await resp.text() }, { status: resp.status })
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
