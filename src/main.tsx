import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Keep the installed PWA fresh: check for a new deploy every 60s while open,
// and immediately whenever the app is brought to the foreground. With
// registerType 'autoUpdate', a new version is applied and the page reloads
// automatically — so changes pushed from the terminal show up on the phone
// without manually clearing anything.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    setInterval(() => registration.update(), 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
