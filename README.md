# ShopLens

A unified multi-store dashboard for e-commerce sellers: real orders from Etsy and Amazon in one place, with real-time push notifications when a new order comes in.

**Live demo:** [shoplens-7pi.pages.dev](https://shoplens-7pi.pages.dev)

## What it does

Sellers running multiple storefronts have to check each platform separately to know if they have new orders to ship. ShopLens polls every connected store on a schedule, aggregates real orders into one dashboard, and pushes a native notification to the seller's phone the moment something new comes in — installable as a PWA, so it behaves like a native app on iOS/Android.

## Integrations

| Store | Status |
|---|---|
| Etsy | ✅ Live — OAuth (PKCE), orders + listings (stock/price/views/favorites) |
| Amazon | ✅ Live — SP-API, 4 marketplaces, orders + Sales & Traffic analytics |
| TikTok Shop | 🟡 In review with TikTok (app submitted, awaiting their data-access approval) |

## Key features

- **Bring your own store connections** — no account is hardcoded. Anyone running their own copy enters their own Etsy/Amazon/TikTok app credentials from Settings; they're stored server-side (Cloudflare KV), never shipped in the client bundle
- **Real background push notifications** — a standalone Cloudflare Worker polls every 10 minutes and sends Web Push via VAPID; verified end-to-end delivering to a real iPhone lock screen
- **AI advisor** — a chat grounded in your own real order/traffic data (Claude API) that diagnoses what's actually slowing sales down and suggests next steps, with a hard rule against ever suggesting marketplace-policy workarounds
- **Per-store dashboards** — tapping a store card opens its real orders (product, buyer, amount, status, date), no mock data anywhere
- **Cross-channel performance view** — revenue, order volume, and store-health indicators, currency-aware (never sums across currencies)
- **Installable PWA** — auto-updating service worker, works from the home screen

## Tech stack

- React 19, TypeScript, Vite, Tailwind CSS
- Cloudflare Pages + Pages Functions (Etsy/TikTok OAuth, AI advisor proxy)
- Standalone Cloudflare Worker for cron polling + Web Push + store API calls, backed by Cloudflare KV
- Amazon SP-API, Etsy API v3, TikTok Shop API, Claude API

## Running locally

```bash
npm install
npm run dev
```

Visit `http://localhost:5173`. Connect your own Etsy/Amazon/TikTok store from the Settings screen — no env vars needed for that. An `ANTHROPIC_API_KEY` (set as a Cloudflare Pages secret) is only needed for the AI advisor.
