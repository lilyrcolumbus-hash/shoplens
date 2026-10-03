// GET /api/etsy/callback?code=X&state=Y  (Etsy redirects here)
// Serves an HTML page whose JS reads the PKCE verifier from localStorage,
// posts code+verifier to /api/etsy/token, stores tokens, and redirects to /.
// No cookies — avoids iOS Safari ITP issues.

export const onRequestGet: PagesFunction = async () => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connecting to Etsy…</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; padding: 2rem; text-align: center; color: #1f2937; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #f97316; border-radius: 50%; margin: 1.5rem auto; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .err { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 1rem; margin-top: 1rem; text-align: left; white-space: pre-wrap; word-break: break-word; font-size: 14px; }
    a.btn { display: inline-block; margin-top: 1rem; padding: 0.6rem 1.2rem; background: #f97316; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="spinner" id="spin"></div>
  <p id="msg">Connecting to Etsy…</p>
  <div id="errbox"></div>
  <script>
  (async function () {
    var msg = document.getElementById('msg');
    var spin = document.getElementById('spin');
    var errbox = document.getElementById('errbox');
    function fail(text) {
      spin.style.display = 'none';
      msg.textContent = 'Could not connect';
      errbox.innerHTML = '<div class="err">' + text + '</div><a class="btn" href="/">Back to ShopLens</a>';
    }
    var params = new URLSearchParams(location.search);
    var err = params.get('error');
    if (err) { fail('Etsy returned: ' + err + (params.get('error_description') ? ' — ' + params.get('error_description') : '')); return; }
    var code = params.get('code');
    var state = params.get('state');
    if (!code || !state) { fail('Missing code or state in the URL from Etsy.'); return; }
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('shoplens_etsy_pkce') || 'null'); } catch (e) {}
    if (!saved || !saved.verifier) { fail('Your session expired (the security code was lost). Go back and tap Connect again — make sure you stay in the same browser.'); return; }
    if (state !== saved.state) { fail('Security check failed (state mismatch). Tap Connect again.'); return; }
    try {
      var r = await fetch('/api/etsy/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-shoplens-key': localStorage.getItem('shoplens_owner_key') || '' },
        body: JSON.stringify({ code: code, code_verifier: saved.verifier })
      });
      if (!r.ok) { var t = await r.text(); fail('Token exchange failed (HTTP ' + r.status + '):\\n' + t); return; }
      var tokens = await r.json();
      localStorage.setItem('shoplens_etsy_tokens', JSON.stringify(tokens));
      localStorage.removeItem('shoplens_etsy_pkce');
      msg.textContent = 'Connected! Loading your orders…';
      location.replace('/');
    } catch (e) {
      fail('Network error: ' + (e && e.message ? e.message : e));
    }
  })();
  </script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
