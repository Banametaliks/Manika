import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { DataProvider, missingConfig, supabase, useStore } from './data/store'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import TileView from './pages/TileView'
import Chat from './pages/Chat'
import Bookings from './pages/Bookings'
import Masters from './pages/Masters'
import VendorLedger from './pages/VendorLedger'
import AccountBook from './pages/AccountBook'
import Expenses from './pages/Expenses'
import { useOnline } from './components/ui'
import icon from './assets/icon.svg'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (missingConfig) return <NotConnected />
  if (supabase && session === undefined) return <Splash />
  if (supabase && !session) return <Login />
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}

function Shell() {
  const { exhibitions, exhibition, setExhibitionId, repo, error, loading } = useStore()
  const online = useOnline()
  const { pathname } = useLocation()
  const isChat = pathname.startsWith('/chat')

  if (loading) return <Splash />
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col">
      <header className="pt-safe sticky top-0 z-20 bg-brand-900 text-white shadow">
        <div className="flex items-center gap-2 px-4 py-3">
          <img src={icon} alt="" className="h-8 w-8 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider text-gold-200">Manika Exhibition</div>
            {exhibitions.length > 1 ? (
              <select
                aria-label="Exhibition"
                className="w-full truncate bg-transparent text-base font-semibold outline-none [&>option]:text-stone-900"
                value={exhibition?.id ?? ''}
                onChange={(e) => setExhibitionId(e.target.value)}
              >
                {exhibitions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            ) : (
              <div className="truncate text-base font-semibold">{exhibition?.name ?? 'No exhibition yet'}</div>
            )}
          </div>
          {supabase && (
            <button className="rounded-lg px-2 py-1 text-xs text-brand-200 hover:bg-white/10" onClick={() => supabase!.auth.signOut()}>
              Sign out
            </button>
          )}
        </div>
        {repo.mode === 'demo' && (
          <div className="bg-amber-300 px-4 py-1 text-center text-xs font-medium text-amber-950">
            Demo mode: data is saved on this phone only. Connect Supabase to go live.
          </div>
        )}
        {!online && <div className="bg-rose-600 px-4 py-1 text-center text-xs font-medium">You are offline. Changes won’t save until you reconnect.</div>}
        {error && <div className="bg-rose-100 px-4 py-1 text-center text-xs text-rose-800">{error}</div>}
      </header>

      <main className={`flex-1 ${isChat ? 'flex min-h-0 flex-col' : 'overflow-y-auto px-4 pb-24 pt-4'}`}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tile/:tile" element={<TileView />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/masters" element={<Masters />} />
          <Route path="/vendors/:id" element={<VendorLedger />} />
          <Route path="/accounts/:id" element={<AccountBook />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <nav className={`pb-safe ${isChat ? '' : 'fixed bottom-0 left-0 right-0'} z-20 border-t border-stone-200 bg-white`}>
        <div className="mx-auto grid max-w-xl grid-cols-5">
          <Tab to="/" icon="▦" label="Dashboard" end />
          <Tab to="/chat" icon="💬" label="Chat" />
          <Tab to="/bookings" icon="🧾" label="Bookings" />
          <Tab to="/expenses" icon="💸" label="Expenses" />
          <Tab to="/masters" icon="⚙︎" label="Masters" />
        </div>
      </nav>
    </div>
  )
}

function Tab({ to, icon, label, end }: { to: string; icon: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-brand-800' : 'text-stone-500'}`
      }
    >
      <span className="text-xl leading-none">{icon}</span>
      {label}
    </NavLink>
  )
}

function NotConnected() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-brand-900 px-6 text-center text-white">
      <img src={icon} alt="" className="h-16 w-16 rounded-2xl" />
      <h1 className="text-xl font-semibold">App is not connected to the database</h1>
      <p className="max-w-sm text-sm text-brand-200">
        This build has no Supabase keys. In Vercel, open Project → Settings → Environment Variables, add
        <b className="text-white"> VITE_SUPABASE_URL</b> and <b className="text-white">VITE_SUPABASE_ANON_KEY</b>,
        then redeploy.
      </p>
    </div>
  )
}

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-brand-900 text-white">
      <img src={icon} alt="" className="h-16 w-16 animate-pulse rounded-2xl" />
      <div className="text-sm text-brand-200">Loading…</div>
    </div>
  )
}
