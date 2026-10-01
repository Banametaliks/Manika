import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Account, Exhibition, ID, Vendor } from '../lib/types'
import { buildIndex, tileSummaries, type Index, type TileSummary } from '../lib/compute'
import type { ExhibitionRows, Repo } from './repo'
import { createSupabaseClient, supabaseRepo } from './supabase'
import { localRepo } from './local'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null = url && key ? createSupabaseClient(url, key) : null
export const repo: Repo = supabase ? supabaseRepo(supabase) : localRepo()

const EX_KEY = 'manika-exhibition-id'
const EMPTY: ExhibitionRows = { stalls: [], bookings: [], bookingStalls: [], payments: [] }

export interface Store {
  repo: Repo
  loading: boolean
  error: string | null
  exhibitions: Exhibition[]
  exhibition: Exhibition | null
  setExhibitionId(id: ID): void
  vendors: Vendor[]
  accounts: Account[]
  rows: ExhibitionRows
  idx: Index
  tiles: TileSummary[]
  refresh(): Promise<void>
}

const Ctx = createContext<Store | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [rows, setRows] = useState<ExhibitionRows>(EMPTY)
  const [exId, setExId] = useState<ID | null>(() => safeGet(EX_KEY))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const exIdRef = useRef(exId)
  exIdRef.current = exId

  const refresh = useCallback(async () => {
    try {
      const [ex, v, a] = await Promise.all([repo.listExhibitions(), repo.listVendors(), repo.listAccounts()])
      setExhibitions(ex)
      setVendors(v)
      setAccounts(a)
      // Keep the chosen exhibition if it still exists, else pick the latest active one.
      let id = exIdRef.current
      if (!id || !ex.some((e) => e.id === id)) id = (ex.find((e) => e.is_active) ?? ex[0])?.id ?? null
      if (id !== exIdRef.current) { exIdRef.current = id; setExId(id) }
      setRows(id ? await repo.loadExhibition(id) : EMPTY)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh, exId])

  // Live updates: coalesce bursts of change events into one reload.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = repo.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 250)
    })
    return () => { clearTimeout(timer); off() }
  }, [refresh])

  const setExhibitionId = useCallback((id: ID) => {
    safeSet(EX_KEY, id)
    setExId(id)
  }, [])

  const idx = useMemo(() => buildIndex({ ...rows, vendors }), [rows, vendors])
  const tiles = useMemo(() => tileSummaries(rows.stalls, idx), [rows.stalls, idx])
  const exhibition = exhibitions.find((e) => e.id === exId) ?? null

  const value: Store = {
    repo, loading, error, exhibitions, exhibition, setExhibitionId,
    vendors, accounts, rows, idx, tiles, refresh,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside DataProvider')
  return s
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* ignore */ }
}
