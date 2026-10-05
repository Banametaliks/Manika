import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../data/store'
import type { Account, AccountKind, Exhibition, Stall, Vendor } from '../lib/types'
import { areaFromSize, fmtDate, inr, inrShort, naturalCompare, today, addDays } from '../lib/format'
import { groupBy } from '../lib/compute'
import { ConfirmButton, Empty, Field, Sheet } from '../components/ui'
import ProfitStatement from './ProfitStatement'

type Tab = 'exhibitions' | 'stalls' | 'vendors' | 'bank' | 'cash' | 'profit'
const TABS: [Tab, string][] = [['stalls', 'Stalls'], ['vendors', 'Vendors'], ['bank', 'Bank'], ['cash', 'Cash'], ['exhibitions', 'Exhibitions'], ['profit', 'Profit']]

export default function Masters() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'stalls'
  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setParams({ tab: t }, { replace: true })}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${tab === t ? 'bg-brand-800 text-white' : 'bg-white text-stone-700 ring-1 ring-stone-200'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'exhibitions' && <Exhibitions />}
      {tab === 'stalls' && <Stalls />}
      {tab === 'vendors' && <Vendors />}
      {(tab === 'bank' || tab === 'cash') && <Accounts kind={tab} />}
      {tab === 'profit' && <ProfitStatement />}
    </div>
  )
}

/** Runs a save, shows errors, closes on success. */
function useSaver(onDone: () => void) {
  const { refresh } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await fn(); await refresh(); onDone() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return { busy, error, run }
}

const blank = (s: string) => (s.trim() ? s.trim() : null)

// ───────────── Exhibitions ─────────────

function Exhibitions() {
  const { exhibitions, exhibition, setExhibitionId } = useStore()
  const [edit, setEdit] = useState<Exhibition | 'new' | null>(null)
  return (
    <>
      <button className="btn-primary w-full" onClick={() => setEdit('new')}>➕ New exhibition</button>
      {exhibitions.length === 0 ? <Empty>No exhibitions yet.</Empty> : (
        <ul className="space-y-2">
          {exhibitions.map((e) => (
            <li key={e.id} className="card flex items-center gap-3 px-4 py-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => setEdit(e)}>
                <div className="truncate font-semibold">{e.name}</div>
                <div className="text-xs text-stone-500">{[e.venue, e.city].filter(Boolean).join(', ')} · {fmtDate(e.start_date)} – {fmtDate(e.end_date, true)}{e.is_active ? '' : ' · closed'}</div>
              </button>
              {exhibition?.id === e.id
                ? <span className="text-xs font-semibold text-brand-800">Current</span>
                : <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setExhibitionId(e.id)}>Open</button>}
            </li>
          ))}
        </ul>
      )}
      {edit && <ExhibitionForm ex={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function ExhibitionForm({ ex, onClose }: { ex: Exhibition | null; onClose(): void }) {
  const { repo, setExhibitionId } = useStore()
  const { busy, error, run } = useSaver(onClose)
  const [f, setF] = useState({
    name: ex?.name ?? '', venue: ex?.venue ?? '', city: ex?.city ?? '',
    start_date: ex?.start_date ?? today(), end_date: ex?.end_date ?? addDays(today(), 4), is_active: ex?.is_active ?? true,
  })
  const save = () => run(async () => {
    if (!f.name.trim()) throw new Error('Name is required')
    if (f.end_date < f.start_date) throw new Error('End date is before start date')
    const row = { name: f.name.trim(), venue: blank(f.venue), city: blank(f.city), start_date: f.start_date, end_date: f.end_date, is_active: f.is_active }
    if (ex) await repo.update('exhibitions', ex.id, row)
    else { const [c] = await repo.insert('exhibitions', [row]); setExhibitionId(c.id) }
  })
  return (
    <Sheet open onClose={onClose} title={ex ? 'Edit exhibition' : 'New exhibition'}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Manika Diwali Expo 2026" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Venue"><input className="input" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></Field>
          <Field label="City"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Starts"><input type="date" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="Ends"><input type="date" className="input" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active (shows first)</label>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {ex && <DeleteButton table="exhibitions" id={ex.id} label="exhibition and its stalls" onDone={onClose} />}
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </Sheet>
  )
}

function DeleteButton({ table, id, label, onDone }: { table: 'exhibitions' | 'stalls' | 'vendors' | 'accounts'; id: string; label: string; onDone(): void }) {
  const { repo } = useStore()
  const { busy, error, run } = useSaver(onDone)
  return (
    <>
      <ConfirmButton disabled={busy} label="Delete" question={`Delete this ${label}? This cannot be undone.`} confirmLabel="Delete" onConfirm={() => void run(() => repo.remove(table, id))} />
      {error && <p className="basis-full text-sm text-rose-700">{error}</p>}
    </>
  )
}

// ───────────── Stalls ─────────────

function Stalls() {
  const { rows, exhibition, idx } = useStore()
  const [edit, setEdit] = useState<Stall | 'new' | null>(null)
  const [bulk, setBulk] = useState(false)
  const [copy, setCopy] = useState(false)
  const byTile = useMemo(() => [...groupBy(rows.stalls, (s) => s.tile)].sort((a, b) => naturalCompare(a[0], b[0])), [rows.stalls])

  if (!exhibition) return <Empty>Create an exhibition first.</Empty>
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <button className="btn-primary" onClick={() => setBulk(true)}>➕ Bulk add</button>
        <button className="btn-ghost" onClick={() => setEdit('new')}>Add one</button>
        <button className="btn-ghost" onClick={() => setCopy(true)}>Copy layout</button>
      </div>
      {byTile.length === 0 ? <Empty>No stalls in {exhibition.name} yet. Use <b>Bulk add</b> to create a whole tile at once (e.g. A-1 to A-20).</Empty> : byTile.map(([tile, list]) => (
        <section key={tile} className="card overflow-hidden">
          <h3 className="bg-stone-50 px-4 py-2 text-sm font-semibold">Tile {tile} <span className="font-normal text-stone-500">· {list.length} stalls</span></h3>
          <ul className="divide-y divide-stone-100">
            {list.sort((a, b) => naturalCompare(a.number, b.number)).map((s) => (
              <li key={s.id}>
                <button className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm" onClick={() => setEdit(s)}>
                  <span className="w-14 font-semibold">{s.number}</span>
                  <span className="flex-1 text-stone-500">{[s.size, s.stall_type, s.blocked ? 'Blocked' : null].filter(Boolean).join(' · ')}</span>
                  <span>{inr(s.price)}</span>
                  {idx.bookingByStall.has(s.id) && <span title="Booked" className="text-xs text-stone-400">●</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {edit && <StallForm stall={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {bulk && <BulkStalls onClose={() => setBulk(false)} />}
      {copy && <CopyLayout onClose={() => setCopy(false)} />}
    </>
  )
}

function StallForm({ stall, onClose }: { stall: Stall | null; onClose(): void }) {
  const { repo, exhibition, rows } = useStore()
  const { busy, error, run } = useSaver(onClose)
  const lastTile = rows.stalls[rows.stalls.length - 1]?.tile ?? 'A'
  const [f, setF] = useState({
    number: stall?.number ?? '', tile: stall?.tile ?? lastTile, size: stall?.size ?? '3x3',
    area: stall?.area?.toString() ?? '', stall_type: stall?.stall_type ?? '', price: stall?.price?.toString() ?? '',
    blocked: stall?.blocked ?? false, notes: stall?.notes ?? '',
  })
  const save = () => run(async () => {
    if (!f.number.trim() || !f.tile.trim()) throw new Error('Stall number and tile are required')
    const price = Number(f.price)
    if (!(price >= 0) || f.price === '') throw new Error('Enter a price')
    const row = {
      exhibition_id: exhibition!.id, number: f.number.trim().toUpperCase(), tile: f.tile.trim().toUpperCase(),
      size: blank(f.size), area: f.area ? Number(f.area) : areaFromSize(f.size), stall_type: blank(f.stall_type),
      price, blocked: f.blocked, notes: blank(f.notes),
    }
    if (stall) await repo.update('stalls', stall.id, row)
    else await repo.insert('stalls', [row])
  })
  return (
    <Sheet open onClose={onClose} title={stall ? `Edit stall ${stall.number}` : 'Add stall'}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Stall number"><input className="input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} placeholder="A-1" /></Field>
          <Field label="Tile / zone"><input className="input" value={f.tile} onChange={(e) => setF({ ...f, tile: e.target.value })} placeholder="A" /></Field>
          <Field label="Size (W x D)"><input className="input" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} placeholder="3x3" /></Field>
          <Field label="Area (auto from size)"><input className="input" inputMode="decimal" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder={String(areaFromSize(f.size) ?? '')} /></Field>
          <Field label="Price ₹"><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Type"><input className="input" value={f.stall_type} onChange={(e) => setF({ ...f, stall_type: e.target.value })} placeholder="Corner, Premium…" list="stall-types" /></Field>
        </div>
        <StallTypes />
        <Field label="Notes"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.checked })} /> Blocked (not for sale)</label>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {stall && <DeleteButton table="stalls" id={stall.id} label="stall" onDone={onClose} />}
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </Sheet>
  )
}

const StallTypes = () => (
  <datalist id="stall-types">{['Corner', 'Inline', 'Premium', 'Island', 'Food'].map((t) => <option key={t} value={t} />)}</datalist>
)

function BulkStalls({ onClose }: { onClose(): void }) {
  const { repo, exhibition, rows } = useStore()
  const { busy, error, run } = useSaver(onClose)
  const nextTile = String.fromCharCode(65 + new Set(rows.stalls.map((s) => s.tile)).size)
  const [f, setF] = useState({ tile: nextTile, prefix: `${nextTile}-`, from: '1', to: '10', size: '3x3', price: '', stall_type: '' })
  const from = parseInt(f.from), to = parseInt(f.to)
  const count = from > 0 && to >= from ? to - from + 1 : 0
  const save = () => run(async () => {
    if (!f.tile.trim()) throw new Error('Tile is required')
    if (!count || count > 500) throw new Error('Check the from / to numbers')
    if (f.price === '' || !(Number(f.price) >= 0)) throw new Error('Enter a price')
    const area = areaFromSize(f.size)
    const list = Array.from({ length: count }, (_, i) => ({
      exhibition_id: exhibition!.id, number: `${f.prefix}${from + i}`.toUpperCase(), tile: f.tile.trim().toUpperCase(),
      size: blank(f.size), area, stall_type: blank(f.stall_type), price: Number(f.price), blocked: false, notes: null,
    }))
    await repo.insert('stalls', list)
  })
  return (
    <Sheet open onClose={onClose} title="Bulk add stalls">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tile / zone"><input className="input" value={f.tile} onChange={(e) => setF({ ...f, tile: e.target.value, prefix: `${e.target.value}-` })} /></Field>
          <Field label="Number prefix"><input className="input" value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} /></Field>
          <Field label="From no."><input className="input" inputMode="numeric" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To no."><input className="input" inputMode="numeric" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="Size (W x D)"><input className="input" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} /></Field>
          <Field label="Price ₹ (each)"><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        </div>
        <Field label="Type (optional)"><input className="input" value={f.stall_type} onChange={(e) => setF({ ...f, stall_type: e.target.value })} list="stall-types" /></Field>
        <StallTypes />
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">
          {count ? <>Creates <b>{count}</b> stalls: {f.prefix}{from}{count > 1 ? ` … ${f.prefix}${to}` : ''} in tile {f.tile || '?'}{f.price ? `, ${inr(Number(f.price))} each` : ''}.</> : 'Enter a valid range.'}
          {' '}Edit corners or premium stalls one by one afterwards.
        </p>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !count} onClick={save}>Create {count || ''} stalls</button>
      </div>
    </Sheet>
  )
}

/** Copies stall layout (numbers, tiles, sizes, prices) from a previous exhibition. */
function CopyLayout({ onClose }: { onClose(): void }) {
  const { repo, exhibition, exhibitions, rows } = useStore()
  const { busy, error, run } = useSaver(onClose)
  const others = exhibitions.filter((e) => e.id !== exhibition?.id)
  const [src, setSrc] = useState(others[0]?.id ?? '')
  const save = () => run(async () => {
    const { stalls } = await repo.loadExhibition(src)
    const have = new Set(rows.stalls.map((s) => s.number.toLowerCase()))
    const list = stalls.filter((s) => !have.has(s.number.toLowerCase())).map((s) => ({
      exhibition_id: exhibition!.id, number: s.number, tile: s.tile, size: s.size, area: s.area,
      stall_type: s.stall_type, price: s.price, blocked: false, notes: s.notes,
    }))
    if (!list.length) throw new Error('Nothing to copy: all those stall numbers already exist here.')
    await repo.insert('stalls', list)
  })
  return (
    <Sheet open onClose={onClose} title="Copy stall layout">
      {others.length === 0 ? <Empty>No other exhibition to copy from yet.</Empty> : (
        <div className="space-y-3">
          <Field label="Copy stalls from">
            <select className="input" value={src} onChange={(e) => setSrc(e.target.value)}>
              {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <p className="text-sm text-stone-500">Stall numbers, tiles, sizes and prices are copied into {exhibition?.name}. Bookings are not copied. You can change prices afterwards.</p>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || !src} onClick={save}>Copy layout</button>
        </div>
      )}
    </Sheet>
  )
}

// ───────────── Vendors ─────────────

function Vendors() {
  const { vendors, idx } = useStore()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Vendor | 'new' | null>(null)
  const needle = q.trim().toLowerCase()
  const list = vendors.filter((v) => !needle || [v.name, v.business_name, v.phone, v.category, v.city].join(' ').toLowerCase().includes(needle))
  return (
    <>
      <div className="flex gap-2">
        <input className="input flex-1" placeholder={`Search ${vendors.length} vendors…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => setEdit('new')}>➕ Add</button>
      </div>
      {list.length === 0 ? <Empty>No vendors found.</Empty> : (
        <ul className="card divide-y divide-stone-100">
          {list.map((v) => {
            const due = (idx.bookingsByVendor.get(v.id) ?? []).reduce((a, b) => a + b.balance, 0)
            const stalls = (idx.bookingsByVendor.get(v.id) ?? []).flatMap((b) => b.stalls.map((s) => s.number))
            return (
              <li key={v.id}>
                <Link to={`/vendors/${v.id}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{v.name}{v.business_name && v.business_name !== v.name ? <span className="font-normal text-stone-500"> · {v.business_name}</span> : null}</div>
                    <div className="truncate text-xs text-stone-500">{[v.phone, v.category, stalls.length ? `Stall ${stalls.join(', ')}` : null].filter(Boolean).join(' · ')}</div>
                  </div>
                  {due > 0 && <span className="text-xs font-semibold text-rose-700">Due {inrShort(due)}</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {edit && <VendorForm vendor={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

export function VendorForm({ vendor, onClose }: { vendor: Vendor | null; onClose(): void }) {
  const { repo } = useStore()
  const { busy, error, run } = useSaver(onClose)
  const [f, setF] = useState({
    name: vendor?.name ?? '', business_name: vendor?.business_name ?? '', phone: vendor?.phone ?? '',
    gstin: vendor?.gstin ?? '', city: vendor?.city ?? '', category: vendor?.category ?? '', notes: vendor?.notes ?? '',
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const save = () => run(async () => {
    if (!f.name.trim()) throw new Error('Name is required')
    const phone = f.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
    if (phone && phone.length !== 10) throw new Error('Mobile number should have 10 digits')
    const row = {
      name: f.name.trim(), business_name: blank(f.business_name), phone: phone || null, gstin: blank(f.gstin.toUpperCase()),
      city: blank(f.city), category: blank(f.category), notes: blank(f.notes),
    }
    if (vendor) await repo.update('vendors', vendor.id, row)
    else await repo.insert('vendors', [row])
  })
  return (
    <Sheet open onClose={onClose} title={vendor ? 'Edit vendor' : 'New vendor'}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Business / shop name"><input className="input" value={f.business_name} onChange={set('business_name')} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mobile"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="City"><input className="input" value={f.city} onChange={set('city')} /></Field>
          <Field label="Category"><input className="input" value={f.category} onChange={set('category')} /></Field>
          <Field label="GSTIN"><input className="input" value={f.gstin} onChange={set('gstin')} /></Field>
        </div>
        <Field label="Notes"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {vendor && <DeleteButton table="vendors" id={vendor.id} label="vendor" onDone={onClose} />}
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </Sheet>
  )
}

// ───────────── Bank & cash accounts ─────────────

function Accounts({ kind }: { kind: AccountKind }) {
  const { accounts, rows } = useStore()
  const [edit, setEdit] = useState<Account | 'new' | null>(null)
  const list = accounts.filter((a) => a.kind === kind)
  return (
    <>
      <button className="btn-primary w-full" onClick={() => setEdit('new')}>➕ Add {kind === 'bank' ? 'bank account' : 'cash book'}</button>
      {list.length === 0 ? <Empty>No {kind} accounts yet.</Empty> : (
        <ul className="space-y-2">
          {list.map((a) => {
            const received = rows.payments.filter((p) => p.account_id === a.id).reduce((s, p) => s + p.amount, 0)
            const spent = rows.expenses.filter((e) => e.account_id === a.id).reduce((s, e) => s + e.amount, 0)
            return (
              <li key={a.id} className="card flex items-center gap-3 px-4 py-3">
                <Link to={`/accounts/${a.id}`} className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{a.name}{a.is_default && <span className="ml-2 text-xs font-medium text-brand-700">Default</span>}</div>
                  <div className="truncate text-xs text-stone-500">
                    {kind === 'bank' ? [a.bank_name, a.account_no && `A/c ••${a.account_no.slice(-4)}`, a.upi_id].filter(Boolean).join(' · ') : 'Cash book'}
                  </div>
                  <div className="text-xs text-stone-500">This exhibition: {inr(received)} received{spent ? ` · ${inr(spent)} spent` : ''}</div>
                </Link>
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEdit(a)}>Edit</button>
              </li>
            )
          })}
        </ul>
      )}
      {edit && <AccountForm kind={kind} account={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function AccountForm({ kind, account, onClose }: { kind: AccountKind; account: Account | null; onClose(): void }) {
  const { repo, accounts } = useStore()
  const { busy, error, run } = useSaver(onClose)
  const [f, setF] = useState({
    name: account?.name ?? '', bank_name: account?.bank_name ?? '', account_no: account?.account_no ?? '', ifsc: account?.ifsc ?? '',
    upi_id: account?.upi_id ?? '', opening_balance: account?.opening_balance?.toString() ?? '0',
    is_default: account?.is_default ?? !accounts.some((a) => a.kind === kind),
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const save = () => run(async () => {
    if (!f.name.trim()) throw new Error('Name is required')
    const row = {
      kind, name: f.name.trim(), bank_name: blank(f.bank_name), account_no: blank(f.account_no), ifsc: blank(f.ifsc.toUpperCase()),
      upi_id: blank(f.upi_id), opening_balance: Number(f.opening_balance) || 0, is_default: f.is_default,
    }
    // Only one default per kind.
    if (f.is_default) for (const a of accounts) if (a.kind === kind && a.is_default && a.id !== account?.id) await repo.update('accounts', a.id, { is_default: false })
    if (account) await repo.update('accounts', account.id, row)
    else await repo.insert('accounts', [row])
  })
  return (
    <Sheet open onClose={onClose} title={account ? 'Edit account' : kind === 'bank' ? 'New bank account' : 'New cash book'}>
      <div className="space-y-3">
        <Field label="Name (shown in chat)"><input className="input" value={f.name} onChange={set('name')} placeholder={kind === 'bank' ? 'HDFC Current' : 'Cash in hand'} /></Field>
        {kind === 'bank' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Bank"><input className="input" value={f.bank_name} onChange={set('bank_name')} /></Field>
            <Field label="Account no."><input className="input" inputMode="numeric" value={f.account_no} onChange={set('account_no')} /></Field>
            <Field label="IFSC"><input className="input" value={f.ifsc} onChange={set('ifsc')} /></Field>
            <Field label="UPI ID"><input className="input" value={f.upi_id} onChange={set('upi_id')} /></Field>
          </div>
        )}
        <Field label="Opening balance ₹"><input className="input" inputMode="decimal" value={f.opening_balance} onChange={set('opening_balance')} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} /> Default (suggested first in chat)</label>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {account && <DeleteButton table="accounts" id={account.id} label="account" onDone={onClose} />}
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </Sheet>
  )
}
