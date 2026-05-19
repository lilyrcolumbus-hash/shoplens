// GET /api/etsy/callback?code=X&state=Y
// Etsy redirects here after user authorizes.
// Exchanges code for access_token + refresh_token using PKCE verifier from cookie.
// Returns HTML page that stores tokens in localStorage and redirects to /.

interface Env {
  ETSY_KEYSTRING: string
  ETSY_REDIRECT_URI: string
}

function getCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? match[1] : null
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return new Response(`OAuth error: ${error} — ${url.searchParams.get('error_description') ?? ''}`, { status: 400 })
  }

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 })
  }

  const cookieHeader = request.headers.get('Cookie')
  const verifier = getCookie(cookieHeader, 'etsy_pkce_verifier')
  const cookieState = getCookie(cookieHeader, 'etsy_oauth_state')

  if (!verifier || !cookieState) {
    return new Response('Missing PKCE cookies — restart OAuth flow', { status: 400 })
  }
  if (state !== cookieState) {
    return new Response('State mismatch — possible CSRF', { status: 400 })
  }

  const tokenResp = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.ETSY_KEYSTRING,
      redirect_uri: env.ETSY_REDIRECT_URI,
      code,
      code_verifier: verifier,
    }),
  })

  if (!tokenResp.ok) {
    const errText = await tokenResp.text()
    return new Response(`Token exchange failed: ${tokenResp.status} ${errText}`, { status: 500 })
  }

  const tokens = await tokenResp.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
    token_type: string
  }

  const expiresAt = Date.now() + tokens.expires_in * 1000
  const tokenPayload = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
  }

  // Clear PKCE cookies and pass tokens to client via inline script
  const isSecure = url.protocol === 'https:'
  const clearOpts = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? '; Secure' : ''}`

  const html = `<!DOCTYPE html>
<html><head><title>Connecting...</title></head><body>
<p>Connecting to Etsy...</p>
<script>
  try {
    localStorage.setItem('shoplens_etsy_tokens', ${JSON.stringify(JSON.stringify(tokenPayload))});
    location.replace('/');
  } catch (e) {
    document.body.innerHTML = '<pre>Failed to store tokens: ' + e + '</pre>';
  }
</script>
</body></html>`

  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
  })
  headers.append('Set-Cookie', `etsy_pkce_verifier=; ${clearOpts}`)
  headers.append('Set-Cookie', `etsy_oauth_state=; ${clearOpts}`)

  return new Response(html, { status: 200, headers })
}
