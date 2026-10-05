import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { MODE_LABEL, fmtDate, inr } from '../lib/format'
import type { PaymentMode } from '../lib/types'
import { Empty } from '../components/ui'

interface Entry {
  id: string
  date: string
  /** + money in (receipt), − money out (expense) */
  amount: number
  title: string
  detail: string
}

/** Cash book / bank book: receipts in, expenses out, with a running balance. */
export default function AccountBook() {
  const { id = '' } = useParams()
  const { accounts, repo, vendors, exhibitions, rows } = useStore()
  const nav = useNavigate()
  const account = accounts.find((a) => a.id === id)
  const [list, setList] = useState<Entry[] | null>(null)

  useEffect(() => {
    let live = true
    const exName = (eid: string) => exhibitions.find((e) => e.id === eid)?.name ?? ''
    const line = (no: string, date: string, mode: PaymentMode, exId: string) => `${no} · ${fmtDate(date)} · ${MODE_LABEL[mode]} · ${exName(exId)}`
    Promise.all([repo.accountPayments(id), repo.accountExpenses(id)]).then(([pays, exps]) => {
      if (!live) return
      const entries: Entry[] = [
        ...pays.map((p) => ({
          id: p.id, date: p.payment_date, amount: p.amount,
          title: vendors.find((v) => v.id === p.vendor_id)?.name ?? 'Receipt',
          detail: line(`Receipt #${p.receipt_no}`, p.payment_date, p.mode, p.exhibition_id),
        })),
        ...exps.map((e) => ({
          id: e.id, date: e.expense_date, amount: -e.amount,
          title: `${e.category}${e.payee ? ` · ${e.payee}` : ''}`,
          detail: line(`Voucher #${e.voucher_no}`, e.expense_date, e.mode, e.exhibition_id),
        })),
      ]
      // Oldest first for the running balance; money in before money out on the same day.
      entries.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
      setList(entries)
    })
    return () => { live = false }
  }, [id, repo, rows, vendors, exhibitions])

  if (!account) return <Empty>Account not found.</Empty>
  let running = account.opening_balance
  const withBalance = (list ?? []).map((e) => ({ e, balance: (running += e.amount) }))
  const totalIn = (list ?? []).filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0)
  const totalOut = (list ?? []).filter((e) => e.amount < 0).reduce((a, e) => a - e.amount, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav(-1)} className="rounded-full bg-white px-3 py-1.5 text-sm shadow-sm ring-1 ring-stone-200">← Back</button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{account.name}</h1>
      </div>
      <div className="card grid grid-cols-3 divide-x divide-stone-100 py-3 text-center text-xs tabular-nums">
        <div><div className="font-semibold text-emerald-800">+{inr(totalIn)}</div><div className="text-stone-500">Received</div></div>
        <div><div className="font-semibold text-rose-700">−{inr(totalOut)}</div><div className="text-stone-500">Spent</div></div>
        <div><div className="text-base font-bold">{inr(running)}</div><div className="text-stone-500">Balance</div></div>
      </div>
      {!list ? <p className="text-sm text-stone-500">Loading…</p> : (
        <ul className="card divide-y divide-stone-100 text-sm">
          <li className="flex justify-between px-4 py-2 text-stone-500"><span>Opening balance</span><span className="tabular-nums">{inr(account.opening_balance)}</span></li>
          {[...withBalance].reverse().map(({ e, balance }) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{e.title}</div>
                <div className="truncate text-xs text-stone-500">{e.detail}</div>
              </div>
              <div className="text-right tabular-nums">
                <div className={`font-semibold ${e.amount > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{e.amount > 0 ? '+' : '−'}{inr(Math.abs(e.amount))}</div>
                <div className="text-xs text-stone-500">{inr(balance)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
