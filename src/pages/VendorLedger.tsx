import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { buildIndex, type BookingInfo } from '../lib/compute'
import { MODE_LABEL, fmtDate, inr } from '../lib/format'
import type { Exhibition } from '../lib/types'
import { Empty, Pill, Rows } from '../components/ui'
import { VendorForm } from './Masters'

/** One vendor's bookings and payments across every exhibition. */
export default function VendorLedger() {
  const { id = '' } = useParams()
  const { vendors, repo, rows } = useStore()
  const nav = useNavigate()
  const vendor = vendors.find((v) => v.id === id)
  const [data, setData] = useState<{ exhibitions: Exhibition[]; bookings: BookingInfo[] } | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let live = true
    repo.vendorHistory(id).then((h) => {
      if (!live) return
      const idx = buildIndex({ ...h, vendors })
      setData({ exhibitions: h.exhibitions, bookings: [...idx.bookingInfo.values()] })
    })
    return () => { live = false }
  }, [id, repo, vendors, rows])

  if (!vendor) return <Empty>Vendor not found. <Link to="/masters?tab=vendors" className="underline">Back</Link></Empty>

  const active = data?.bookings.filter((b) => b.booking.status === 'active') ?? []
  const totalBilled = active.reduce((a, b) => a + b.booking.total_amount, 0)
  const totalPaid = (data?.bookings ?? []).reduce((a, b) => a + b.paid, 0)
  const due = active.reduce((a, b) => a + b.balance, 0)
  const exName = (exId: string) => data?.exhibitions.find((e) => e.id === exId)?.name ?? ''

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav(-1)} className="rounded-full bg-white px-3 py-1.5 text-sm shadow-sm ring-1 ring-stone-200">← Back</button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{vendor.name}</h1>
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(true)}>Edit</button>
      </div>

      <div className="card px-4 py-2">
        <Rows rows={[
          ['Business', vendor.business_name ?? '—'],
          ['Mobile', vendor.phone ? <a className="text-brand-800 underline" href={`tel:${vendor.phone}`}>{vendor.phone}</a> : '—'],
          ['Category', vendor.category ?? '—'],
          ['City', vendor.city ?? '—'],
          ...(vendor.gstin ? [['GSTIN', vendor.gstin] as [string, string]] : []),
        ]} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="card py-2"><div className="text-[11px] text-stone-500">Billed</div><div className="font-bold">{inr(totalBilled)}</div></div>
        <div className="card py-2"><div className="text-[11px] text-stone-500">Paid</div><div className="font-bold">{inr(totalPaid)}</div></div>
        <div className="card py-2"><div className="text-[11px] text-stone-500">Due</div><div className={`font-bold ${due > 0 ? 'text-rose-700' : ''}`}>{inr(due)}</div></div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primary" onClick={() => nav(`/chat?q=${encodeURIComponent(`book ${vendor.phone ?? vendor.name}`)}`)}>🏷️ Book stall</button>
        <button className="btn-primary" disabled={!(rows.bookings.some((b) => b.vendor_id === vendor.id))} onClick={() => nav(`/chat?q=${encodeURIComponent(`pay ${vendor.phone ?? vendor.name}`)}`)}>💰 Payment</button>
      </div>

      <h2 className="font-semibold">History</h2>
      {!data ? <p className="text-sm text-stone-500">Loading…</p> : data.bookings.length === 0 ? <Empty>No bookings yet.</Empty> : (
        <ul className="space-y-2">
          {data.bookings.sort((a, b) => b.booking.booking_date.localeCompare(a.booking.booking_date)).map((b) => (
            <li key={b.booking.id} className="card px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{exName(b.booking.exhibition_id)}</div>
                  <div className="text-xs text-stone-500">#{b.booking.booking_no} · {b.stalls.map((s) => s.number).join(', ')} · {fmtDate(b.booking.booking_date, true)}</div>
                </div>
                {b.booking.status === 'cancelled' ? <Pill className="bg-stone-200 text-stone-600">Cancelled</Pill>
                  : b.balance > 0 ? <Pill className="bg-rose-50 text-rose-700">Due {inr(b.balance)}</Pill>
                  : <Pill className="bg-sky-50 text-sky-700">✓ Paid</Pill>}
              </div>
              <div className="mt-2 flex justify-between text-sm"><span className="text-stone-500">Total</span><span className="font-medium">{inr(b.booking.total_amount)}</span></div>
              {b.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-sm">
                  <span className="text-stone-500">#{p.receipt_no} · {fmtDate(p.payment_date)} · {MODE_LABEL[p.mode]}</span>
                  <span>{inr(p.amount)}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {editing && <VendorForm vendor={vendor} onClose={() => setEditing(false)} />}
    </div>
  )
}
