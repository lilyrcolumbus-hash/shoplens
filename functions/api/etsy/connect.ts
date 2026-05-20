// GET /api/etsy/connect?code_challenge=X&state=Y
// Builds the Etsy authorization URL with server-held credentials and redirects.
// PKCE verifier is held client-side in localStorage (no cookies — robust on iOS Safari).

interface Env {
  ETSY_KEYSTRING: string
  ETSY_REDIRECT_URI: string
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const codeChallenge = url.searchParams.get('code_challenge')
  const state = url.searchParams.get('state')

  if (!codeChallenge || !state) {
    return new Response('Missing code_challenge or state', { status: 400 })
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.ETSY_KEYSTRING,
    redirect_uri: env.ETSY_REDIRECT_URI,
    scope: 'transactions_r shops_r listings_r',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return new Response(null, {
    status: 302,
    headers: { Location: `https://www.etsy.com/oauth/connect?${params}` },
  })
}
