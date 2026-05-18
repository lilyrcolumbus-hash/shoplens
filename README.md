# StoreControl

Unified multi-store order dashboard with push notifications. Monitor orders from Etsy, Amazon, TikTok, Whatnot, Shopify, and eBay in one place.

## Quick Start

```bash
npm install
npm run dev
```

Visit `http://localhost:5173` in your browser.

## Build for Production

```bash
npm run build
npm run preview
```

## Stack

- **React 19** + TypeScript
- **Vite 6** for fast development and optimized builds
- **Tailwind CSS v4** with the new `@tailwindcss/vite` plugin
- **Vite PWA Plugin** for service worker, offline support, and installable app
- **lucide-react** for icons

## Features

- Multi-store order aggregation (mock data)
- Real-time statistics: total orders, new orders, revenue
- Filter by store or view all orders
- Push notifications (browser native)
- Mobile-responsive design
- Installable PWA (Add to Home Screen on iOS/Android)

## Next Steps

- [ ] Replace mock orders with real Etsy API integration
- [ ] Add other store API connections (Amazon, TikTok, etc.)
- [ ] Persist order data with backend
- [ ] Real-time order sync with WebSocket or polling
- [ ] Custom notification preferences

## Icon

TODO: Create custom 512x512 icon and place at `public/icon-512.png` for PWA manifest.
