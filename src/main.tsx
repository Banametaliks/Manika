import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// The single-page preview build (npm run build:preview) runs inside a sandboxed
// viewer: no service worker, and navigation kept in memory instead of the URL.
const preview = import.meta.env.VITE_PREVIEW === '1'

if (!preview) import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))

const Router = preview ? MemoryRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)
