// GET /api/etsy/connect
// Initiates Etsy OAuth2 PKCE flow.
// Generates code_verifier + state, sets them in HTTP-only cookies,
// and redirects to Etsy's authorization page.

interface Env {
  ETSY_KEYSTRING: string
  ETSY_REDIRECT_URI: string
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = ''
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(input: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return new Uint8Array(buf)
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes).slice(0, length)
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const codeVerifier = randomString(64)
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier))
  const state = randomString(32)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.ETSY_KEYSTRING,
    redirect_uri: env.ETSY_REDIRECT_URI,
    scope: 'transactions_r shops_r listings_r',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  const url = new URL(request.url)
  const isSecure = url.protocol === 'https:'
  const cookieOpts = `Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isSecure ? '; Secure' : ''}`

  const headers = new Headers({ Location: `https://www.etsy.com/oauth/connect?${params}` })
  headers.append('Set-Cookie', `etsy_pkce_verifier=${codeVerifier}; ${cookieOpts}`)
  headers.append('Set-Cookie', `etsy_oauth_state=${state}; ${cookieOpts}`)

  return new Response(null, { status: 302, headers })
}
