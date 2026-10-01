// GET /api/tiktok/callback?code=X  (TikTok redirects here after the seller authorizes)
// Forwards the auth_code to the worker, which holds the app_secret and exchanges it for
// tokens + shop_cipher (stored in KV). Then redirects back to the app. No secret on the client.

interface Env {
  SHOPLENS_WORKER_URL?: string
}

const DEFAULT_WORKER_URL = 'https://shoplens-push.lilyrcolumbus.workers.dev'

function errorPage(message: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Connecting to TikTok…</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; padding: 2rem; text-align: center; color: #1f2937; }
  .err { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 1rem; margin-top: 1rem; text-align: left; white-space: pre-wrap; word-break: break-word; font-size: 14px; }
  a.btn { display: inline-block; margin-top: 1rem; padding: 0.6rem 1.2rem; background: #fe2c55; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; }
</style></head>
<body>
  <p>Could not connect TikTok</p>
  <div class="err">${message.replace(/</g, '&lt;')}</div>
  <a class="btn" href="/">Back to ShopLens</a>
</body></html>`
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const err = url.searchParams.get('error')
  if (err) {
    return errorPage(`TikTok returned: ${err}${url.searchParams.get('error_description') ? ' — ' + url.searchParams.get('error_description') : ''}`)
  }
  const code = url.searchParams.get('code')
  if (!code) return errorPage('Missing authorization code in the URL from TikTok.')

  const workerUrl = env.SHOPLENS_WORKER_URL || DEFAULT_WORKER_URL
  try {
    const r = await fetch(`${workerUrl}/tiktok/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!r.ok) {
      const text = await r.text()
      return errorPage(`Token exchange failed (HTTP ${r.status}):\n${text}`)
    }
  } catch (e) {
    return errorPage(`Network error contacting the worker: ${e instanceof Error ? e.message : String(e)}`)
  }

  return new Response(null, { status: 302, headers: { Location: '/?tiktok=connected' } })
}
