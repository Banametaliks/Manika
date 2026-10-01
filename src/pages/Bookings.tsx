import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../data/store'
import type { BookingInfo } from '../lib/compute'
import { MODE_LABEL, fmtDate, inr } from '../lib/format'
import { bookingShareText, receiptShareText, waLink } from '../lib/share'
import { ConfirmButton, Empty, Pill, Rows, Sheet } from '../components/ui'

type Filter = 'all' | 'due' | 'paid' | 'cancelled'
type Tab = 'bookings' | 'payments'

export default function Bookings() {
  const { idx, rows, accounts } = useStore()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('bookings')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const openId = params.get('open')

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...idx.bookingInfo.values()]
      .filter((b) => {
        const st = b.booking.status
        if (filter === 'cancelled' ? st !== 'cancelled' : st === 'cancelled' && filter !== 'all') return false
        if (filter === 'due' && b.balance <= 0) return false
        if (filter === 'paid' && b.balance > 0) return false
        if (!needle) return true
        const hay = [b.vendor?.name, b.vendor?.business_name, b.vendor?.phone, `#${b.booking.booking_no}`, ...b.stalls.map((s) => s.number)].join(' ').toLowerCase()
        return hay.includes(needle)
      })
      .sort((a, b) => b.booking.booking_no - a.booking.booking_no)
  }, [idx, filter, q])

  const payments = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...rows.payments]
      .filter((p) => {
        if (!needle) return true
        const v = idx.vendorById.get(p.vendor_id)
        return [v?.name, v?.business_name, `#${p.receipt_no}`, p.reference, MODE_LABEL[p.mode]].join(' ').toLowerCase().includes(needle)
      })
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.receipt_no - a.receipt_no)
  }, [rows.payments, idx, q])

  const open = openId ? idx.bookingInfo.get(openId) : undefined

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 rounded-xl bg-stone-200 p-1 text-sm font-semibold">
        {(['bookings', 'payments'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg py-1.5 capitalize ${tab === t ? 'bg-white shadow-sm' : 'text-stone-600'}`}>{t}</button>
        ))}
      </div>
      <input className="input" placeholder="Search vendor, stall, receipt…" value={q} onChange={(e) => setQ(e.target.value)} />

      {tab === 'bookings' ? (
        <>
          <div className="flex gap-2 overflow-x-auto">
            {(['all', 'due', 'paid', 'cancelled'] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${filter === f ? 'bg-brand-800 text-white ring-brand-800' : 'bg-white text-stone-700 ring-stone-200'}`}>
                {{ all: 'All', due: 'Payment due', paid: 'Fully paid', cancelled: 'Cancelled' }[f]}
              </button>
            ))}
          </div>
          {list.length === 0 ? <Empty>No bookings found.</Empty> : (
            <ul className="space-y-2">
              {list.map((b) => (
                <li key={b.booking.id}>
                  <button onClick={() => setParams({ open: b.booking.id })} className="card flex w-full items-center gap-3 px-4 py-3 text-left active:scale-[.99]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{b.vendor?.business_name || b.vendor?.name}</div>
                      <div className="truncate text-xs text-stone-500">#{b.booking.booking_no} · {b.stalls.map((s) => s.number).join(', ')} · {fmtDate(b.booking.booking_date)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">{inr(b.booking.total_amount)}</div>
                      {b.booking.status === 'cancelled' ? <Pill className="bg-stone-200 text-stone-600">Cancelled</Pill>
                        : b.balance > 0 ? <Pill className="bg-rose-50 text-rose-700">Due {inr(b.balance)}</Pill>
                        : <Pill className="bg-sky-50 text-sky-700">✓ Paid</Pill>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : payments.length === 0 ? <Empty>No payments yet.</Empty> : (
        <ul className="card divide-y divide-stone-100">
          {payments.map((p) => {
            const v = idx.vendorById.get(p.vendor_id)
            return (
              <li key={p.id}>
                <button onClick={() => setParams({ open: p.booking_id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{v?.business_name || v?.name}</div>
                    <div className="truncate text-xs text-stone-500">#{p.receipt_no} · {fmtDate(p.payment_date)} · {MODE_LABEL[p.mode]} · {accounts.find((a) => a.id === p.account_id)?.name}</div>
                  </div>
                  <div className="text-sm font-semibold">{inr(p.amount)}</div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {open && <BookingSheet info={open} onClose={() => setParams({})} />}
    </div>
  )
}

function BookingSheet({ info, onClose }: { info: BookingInfo; onClose(): void }) {
  const { repo, exhibition, accounts, refresh } = useStore()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const b = info.booking
  const cancelled = b.status === 'cancelled'

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn(); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const cancelQuestion = info.paid > 0
    ? `Cancel booking #${b.booking_no}? Its stalls become available again. The ${inr(info.paid)} already received stays on record; settle any refund separately.`
    : `Cancel booking #${b.booking_no}? Its stalls become available again.`

  const share = exhibition && info.vendor
    ? waLink(info.vendor.phone, bookingShareText({ exhibition, booking: b, vendor: info.vendor, stalls: info.stalls, paid: info.paid }))
    : null

  return (
    <Sheet open onClose={onClose} title={`Booking #${b.booking_no}`}>
      <Rows rows={[
        ['Vendor', <Link className="text-brand-800 underline" to={`/vendors/${b.vendor_id}`}>{info.vendor?.name}</Link>],
        ['Business', info.vendor?.business_name ?? '—'],
        ['Mobile', info.vendor?.phone ? <a className="text-brand-800 underline" href={`tel:${info.vendor.phone}`}>{info.vendor.phone}</a> : '—'],
        ['Stalls', info.stalls.map((s) => `${s.number}${s.size ? ` (${s.size})` : ''}`).join(', ')],
        ['Booked on', fmtDate(b.booking_date, true)],
        ['Price', inr(b.gross_amount)],
        ...(b.discount ? [['Discount', `− ${inr(b.discount)}`] as [string, string]] : []),
        ['Total', inr(b.total_amount)],
        ['Paid', inr(info.paid)],
        ['Balance', cancelled ? 'Cancelled' : <span className={info.balance > 0 ? 'text-rose-700' : 'text-emerald-700'}>{inr(info.balance)}</span>],
      ]} />

      <h3 className="mb-1 mt-4 text-sm font-semibold">Payments</h3>
      {info.payments.length === 0 ? <p className="text-sm text-stone-500">No payments yet.</p> : (
        <ul className="divide-y divide-stone-100 text-sm">
          {info.payments.map((p) => {
            const receipt = exhibition && info.vendor
              ? waLink(info.vendor.phone, receiptShareText({ exhibition, payment: p, vendor: info.vendor, stalls: info.stalls, balance: info.balance }))
              : null
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="flex-1">
                  <div className="font-medium">{inr(p.amount)} <span className="font-normal text-stone-500">· {MODE_LABEL[p.mode]}</span></div>
                  <div className="text-xs text-stone-500">#{p.receipt_no} · {fmtDate(p.payment_date)} · {accounts.find((a) => a.id === p.account_id)?.name}{p.reference ? ` · ${p.reference}` : ''}</div>
                </div>
                {receipt && <a href={receipt} target="_blank" rel="noopener" className="rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">WhatsApp</a>}
                <ConfirmButton
                  disabled={busy}
                  label="Delete"
                  className="rounded-lg px-2 py-1 text-xs text-rose-700 ring-1 ring-rose-200"
                  question={`Delete receipt #${p.receipt_no} for ${inr(p.amount)}? The balance goes back up by this amount.`}
                  confirmLabel="Delete receipt"
                  onConfirm={() => void run(() => repo.deletePayment(p.id))}
                />
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-5 grid gap-2">
        {!cancelled && info.balance > 0 && (
          <button className="btn-primary" onClick={() => nav(`/chat?q=${encodeURIComponent(`pay ${info.stalls[0]?.number ?? ''}`)}`)}>💰 Record payment</button>
        )}
        {share && !cancelled && <a className="btn-ghost" href={share} target="_blank" rel="noopener">📤 Share booking on WhatsApp</a>}
        {!cancelled && (
          <ConfirmButton disabled={busy} label="Cancel booking" question={cancelQuestion} confirmLabel="Yes, cancel booking"
            onConfirm={() => void run(() => repo.cancelBooking(b.id)).then(onClose)} />
        )}
      </div>
    </Sheet>
  )
}
