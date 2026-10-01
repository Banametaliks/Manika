import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { STATUS_LABEL, type StallStatus } from '../lib/compute'
import { MODE_LABEL, fmtDate, inr, inrShort, naturalCompare } from '../lib/format'
import type { Stall } from '../lib/types'
import { Empty, Legend, Rows, STATUS_MARK, STATUS_STYLE, Sheet } from '../components/ui'

type Filter = 'all' | 'free' | 'due' | 'paid'

export default function TileView() {
  const { tile = '' } = useParams()
  const { rows, idx, tiles } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Stall | null>(null)

  const summary = tiles.find((t) => t.tile === tile)
  const stalls = rows.stalls.filter((s) => s.tile === tile).sort((a, b) => naturalCompare(a.number, b.number))
  const match = (st: StallStatus) =>
    filter === 'all' || (filter === 'free' && st === 'free') || (filter === 'due' && (st === 'booked' || st === 'partial')) || (filter === 'paid' && st === 'paid')
  const shown = stalls.filter((s) => match(idx.statusByStall.get(s.id)!))

  if (!summary) return <Empty>Tile {tile} not found. <Link to="/" className="underline">Back</Link></Empty>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/" className="rounded-full bg-white px-3 py-1.5 text-sm shadow-sm ring-1 ring-stone-200">← Back</Link>
        <h1 className="text-xl font-bold">Tile {tile}</h1>
      </div>

      <div className="card grid grid-cols-4 divide-x divide-stone-100 py-3 text-center text-xs">
        <div><div className="text-base font-semibold">{summary.total}</div><div className="text-stone-500">Stalls</div></div>
        <div><div className="text-base font-semibold">{summary.booked}</div><div className="text-stone-500">Booked</div></div>
        <div><div className="text-base font-semibold">{summary.free}</div><div className="text-stone-500">Free</div></div>
        <div><div className="text-base font-semibold">{inrShort(summary.pending)}</div><div className="text-stone-500">Pending</div></div>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {(['all', 'free', 'due', 'paid'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${filter === f ? 'bg-brand-800 text-white ring-brand-800' : 'bg-white text-stone-700 ring-stone-200'}`}
          >
            {{ all: 'All', free: 'Available', due: 'Payment due', paid: 'Fully paid' }[f]}
          </button>
        ))}
      </div>

      <Legend />

      {shown.length === 0 ? (
        <Empty>No stalls match this filter.</Empty>
      ) : (
        <div className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4">
          {shown.map((s) => {
            const st = idx.statusByStall.get(s.id)!
            const info = idx.bookingByStall.get(s.id)
            return (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className={`relative flex min-h-[76px] flex-col items-start rounded-xl border-2 p-2 text-left transition active:scale-95 ${STATUS_STYLE[st]}`}
              >
                {STATUS_MARK[st] && <span className="absolute right-1.5 top-1 text-xs font-bold opacity-70">{STATUS_MARK[st]}</span>}
                <span className="text-sm font-bold">{s.number}</span>
                <span className="text-[11px] opacity-80">{s.size ?? ''}</span>
                <span className="mt-auto w-full truncate text-[11px] font-medium">
                  {info ? info.vendor?.business_name || info.vendor?.name : st === 'free' ? inrShort(s.price) : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <StallSheet stall={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

export function StallSheet({ stall, onClose }: { stall: Stall | null; onClose(): void }) {
  const { idx, repo, accounts } = useStore()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  if (!stall) return null
  const st = idx.statusByStall.get(stall.id) ?? 'free'
  const info = idx.bookingByStall.get(stall.id)
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? ''

  const toggleBlock = async () => {
    setBusy(true)
    try { await repo.update('stalls', stall.id, { blocked: !stall.blocked }); onClose() }
    catch (e) { alert(e instanceof Error ? e.message : e) }
    finally { setBusy(false) }
  }

  const rows: [string, React.ReactNode][] = [
    ['Status', `${STATUS_MARK[st]} ${STATUS_LABEL[st]}`.trim()],
    ['Tile', stall.tile],
    ['Size', [stall.size, stall.area ? `${stall.area} sq m` : null].filter(Boolean).join(' · ') || '—'],
    ['Type', stall.stall_type ?? '—'],
    ['Price', inr(stall.price)],
  ]
  if (info) {
    rows.push(
      ['Vendor', <Link className="text-brand-800 underline" to={`/vendors/${info.booking.vendor_id}`}>{info.vendor?.name}</Link>],
      ['Booking', `#${info.booking.booking_no} · ${fmtDate(info.booking.booking_date)}${info.stalls.length > 1 ? ` · ${info.stalls.map((s) => s.number).join(', ')}` : ''}`],
      ['Booking total', inr(info.booking.total_amount)],
      ['Paid', inr(info.paid)],
      ['Balance', <span className={info.balance > 0 ? 'text-rose-700' : 'text-emerald-700'}>{inr(info.balance)}</span>],
    )
  }

  return (
    <Sheet open onClose={onClose} title={`Stall ${stall.number}`}>
      <Rows rows={rows} />
      {info && info.payments.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-semibold">Payments</h3>
          <ul className="divide-y divide-stone-100 text-sm">
            {info.payments.map((p) => (
              <li key={p.id} className="flex justify-between py-1.5">
                <span className="text-stone-600">#{p.receipt_no} · {fmtDate(p.payment_date)} · {MODE_LABEL[p.mode]} · {accName(p.account_id)}</span>
                <span className="font-medium">{inr(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-5 grid gap-2">
        {st === 'free' && <button className="btn-primary" onClick={() => nav(`/chat?q=${encodeURIComponent(`book ${stall.number}`)}`)}>🏷️ Book this stall</button>}
        {info && info.balance > 0 && <button className="btn-primary" onClick={() => nav(`/chat?q=${encodeURIComponent(`pay ${stall.number}`)}`)}>💰 Record payment</button>}
        {info && <button className="btn-ghost" onClick={() => nav(`/bookings?open=${info.booking.id}`)}>Open booking</button>}
        {!info && (
          <button className="btn-ghost" disabled={busy} onClick={toggleBlock}>
            {stall.blocked ? 'Unblock stall' : 'Block stall (hold, not for sale)'}
          </button>
        )}
      </div>
    </Sheet>
  )
}
