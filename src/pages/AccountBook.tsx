import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { MODE_LABEL, fmtDate, inr } from '../lib/format'
import type { Payment } from '../lib/types'
import { Empty } from '../components/ui'

/** Cash book / bank book: every receipt into one account with a running balance. */
export default function AccountBook() {
  const { id = '' } = useParams()
  const { accounts, repo, vendors, exhibitions, rows } = useStore()
  const nav = useNavigate()
  const account = accounts.find((a) => a.id === id)
  const [list, setList] = useState<Payment[] | null>(null)

  useEffect(() => {
    let live = true
    repo.accountPayments(id).then((p) => live && setList(p))
    return () => { live = false }
  }, [id, repo, rows])

  if (!account) return <Empty>Account not found.</Empty>
  let running = account.opening_balance
  const entries = (list ?? []).map((p) => ({ p, balance: (running += p.amount) }))
  const vendorName = (vid: string) => vendors.find((v) => v.id === vid)?.name ?? ''
  const exName = (eid: string) => exhibitions.find((e) => e.id === eid)?.name ?? ''

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav(-1)} className="rounded-full bg-white px-3 py-1.5 text-sm shadow-sm ring-1 ring-stone-200">← Back</button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{account.name}</h1>
      </div>
      <div className="card flex justify-between px-4 py-3">
        <span className="text-stone-500">Balance</span>
        <span className="text-lg font-bold">{inr(running)}</span>
      </div>
      {!list ? <p className="text-sm text-stone-500">Loading…</p> : (
        <ul className="card divide-y divide-stone-100 text-sm">
          <li className="flex justify-between px-4 py-2 text-stone-500"><span>Opening balance</span><span>{inr(account.opening_balance)}</span></li>
          {[...entries].reverse().map(({ p, balance }) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{vendorName(p.vendor_id)}</div>
                <div className="truncate text-xs text-stone-500">#{p.receipt_no} · {fmtDate(p.payment_date)} · {MODE_LABEL[p.mode]} · {exName(p.exhibition_id)}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-emerald-700">+{inr(p.amount)}</div>
                <div className="text-xs text-stone-500">{inr(balance)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
