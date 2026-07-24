import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Single-view app — no router, so no basename needed. When a history router is
// added later, set its basename to import.meta.env.BASE_URL (the Vite `base`).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
