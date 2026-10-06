import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import process from 'node:process'

/**
 * Supabase settings, accepted under the names people actually end up with:
 * our own VITE_ names, or the ones the Vercel ↔ Supabase integration creates
 * (NEXT_PUBLIC_SUPABASE_*, SUPABASE_*). Only the public URL and the public
 * (anon / publishable) key are read; the service-role key is never touched.
 */
function supabaseSettings(env: Record<string, string>) {
  const pick = (...names: string[]) => names.map((n) => env[n]?.trim()).find(Boolean) ?? ''
  const key = pick(
      'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
  )
  // A secret key pasted into the public slot must never be built into the app.
  const secret = isSecretKey(key)
  return { url: pick('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'), key: secret ? '' : key, secretRejected: secret }
}

/** Service-role JWT or sb_secret_ key: full database access, server-side only. */
function isSecretKey(k: string): boolean {
  if (k.startsWith('sb_secret_')) return true
  try {
    const payload = JSON.parse(Buffer.from(k.split('.')[1] ?? '', 'base64url').toString('utf8'))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

export default defineConfig(({ mode }) => {
  const sb = supabaseSettings({ ...loadEnv(mode, process.cwd(), ''), ...(process.env as Record<string, string>) })
  return {
  define: {
    __SUPABASE_URL__: JSON.stringify(sb.url),
    __SUPABASE_KEY__: JSON.stringify(sb.key),
    __SUPABASE_SECRET_REJECTED__: JSON.stringify(sb.secretRejected),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      disable: process.env.VITE_PREVIEW === '1',
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Manika Exhibition',
        short_name: 'Manika',
        description: 'Stall booking and payment management for Manika Exhibition',
        theme_color: '#2a1245',
        background_color: '#f7f3fb',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
}
})
