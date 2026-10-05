import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../data/store'
import { groupBy, profitSummary, type Profit } from '../lib/compute'
import { MODE_LABEL, fmtDate, inr } from '../lib/format'
import type { Expense } from '../lib/types'
import { Empty } from '../components/ui'
import { ExpenseForm } from './Expenses'

/** Masters → Profit: every income line and every expense for the current exhibition, and the result. */
export default function ProfitStatement() {
  const { exhibition, idx, rows } = useStore()
  const [edit, setEdit] = useState<Expense | null>(null)
  const p = useMemo(() => profitSummary(idx, rows.expenses), [idx, rows.expenses])

  const bookings = useMemo(() => [...idx.bookingInfo.values()].sort((a, b) => a.booking.booking_no - b.booking.booking_no), [idx])
  const active = bookings.filter((b) => b.booking.status === 'active')
  const cancelledKept = bookings.filter((b) => b.booking.status === 'cancelled' && b.paid > 0)
  const grossPrice = active.reduce((a, b) => a + b.booking.gross_amount, 0)
  const discounts = active.reduce((a, b) => a + b.booking.discount, 0)
  const expenseGroups = useMemo(() => {
    const g = groupBy(rows.expenses, (e) => e.category)
    return p.byCategory.map((c) => ({ ...c, items: (g.get(c.category) ?? []).sort((a, b) => a.expense_date.localeCompare(b.expense_date)) }))
  }, [rows.expenses, p.byCategory])

  if (!exhibition) return <Empty>Create an exhibition first.</Empty>

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-500">Profit and loss for <b className="text-stone-700">{exhibition.name}</b>. Switch exhibition from the header.</p>
      <Summary p={p} />

      {/* ── Income ── */}
      <section className="card overflow-hidden">
        <Heading title="Income" note={`${active.length} booking${active.length === 1 ? '' : 's'}`} amount={p.income} />
        {active.length === 0 && cancelledKept.length === 0 ? (
          <p className="px-4 py-3 text-sm text-stone-500">No bookings yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {active.map((b) => (
              <li key={b.booking.id}>
                <Link to={`/bookings?open=${b.booking.id}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{b.vendor?.business_name || b.vendor?.name}</div>
                    <div className="truncate text-xs text-stone-500">
                      #{b.booking.booking_no} · {b.stalls.map((s) => s.number).join(', ')}
                      {b.booking.discount > 0 && ` · disc ${inr(b.booking.discount)}`}
                      {' · '}{b.balance > 0 ? <span className="text-rose-700">due {inr(b.balance)}</span> : 'paid'}
                    </div>
                  </div>
                  <span className="font-medium tabular-nums">{inr(b.booking.total_amount)}</span>
                </Link>
              </li>
            ))}
            {cancelledKept.map((b) => (
              <li key={b.booking.id}>
                <Link to={`/bookings?open=${b.booking.id}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{b.vendor?.business_name || b.vendor?.name}</div>
                    <div className="truncate text-xs text-stone-500">#{b.booking.booking_no} · cancelled, amount received kept</div>
                  </div>
                  <span className="font-medium tabular-nums">{inr(b.paid)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {discounts > 0 && (
          <div className="border-t border-stone-100 bg-stone-50 px-4 py-2 text-xs text-stone-500 tabular-nums">
            Stall price {inr(grossPrice)} − discounts {inr(discounts)} = {inr(grossPrice - discounts)}
          </div>
        )}
      </section>

      {/* ── Expenses ── */}
      <section className="card overflow-hidden">
        <Heading title="Expenses" note={`${rows.expenses.length} voucher${rows.expenses.length === 1 ? '' : 's'}`} amount={-p.expenses} />
        {expenseGroups.length === 0 ? (
          <p className="px-4 py-3 text-sm text-stone-500">No expenses yet. Add them from the Expenses tab or the chat.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {expenseGroups.map((g) => (
              <details key={g.category} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm">
                  <span className="text-stone-400 transition group-open:rotate-90" aria-hidden="true">›</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{g.category} <span className="font-normal text-stone-500">· {g.count}</span></span>
                  <span className="font-medium tabular-nums">{inr(g.amount)}</span>
                </summary>
                <ul className="bg-stone-50 pb-1">
                  {g.items.map((e) => (
                    <li key={e.id}>
                      <button className="flex w-full items-center gap-3 py-1.5 pl-9 pr-4 text-left text-xs" onClick={() => setEdit(e)}>
                        <span className="min-w-0 flex-1 truncate text-stone-600">#{e.voucher_no} · {fmtDate(e.expense_date)} · {e.payee ?? MODE_LABEL[e.mode]}</span>
                        <span className="tabular-nums">{inr(e.amount)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* ── Result ── */}
      <section className={`card flex items-baseline justify-between px-4 py-3 ${p.profit < 0 ? 'text-rose-700' : 'text-emerald-800'}`}>
        <span className="font-semibold">{p.profit < 0 ? '▼ Net loss' : '▲ Net profit'}</span>
        <span className="text-xl font-bold tabular-nums">{inr(Math.abs(p.profit))}</span>
      </section>

      {edit && <ExpenseForm expense={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function Heading({ title, note, amount }: { title: string; note: string; amount: number }) {
  return (
    <h2 className="flex items-baseline justify-between border-b border-stone-200 bg-brand-50 px-4 py-2">
      <span className="font-semibold text-brand-900">{title} <span className="text-xs font-normal text-stone-500">· {note}</span></span>
      <span className="font-semibold tabular-nums">{amount < 0 ? '− ' : ''}{inr(Math.abs(amount))}</span>
    </h2>
  )
}

function Summary({ p }: { p: Profit }) {
  const loss = p.profit < 0
  return (
    <section className="card overflow-hidden">
      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 px-4 pt-3 text-sm tabular-nums">
        <span className="text-stone-500">Income</span><span className="text-right font-medium">{inr(p.income)}</span>
        <span className="text-stone-500">Expenses</span><span className="text-right font-medium">− {inr(p.expenses)}</span>
      </div>
      <div className={`mx-4 mt-2 flex items-baseline justify-between border-t border-stone-200 py-2 ${loss ? 'text-rose-700' : 'text-emerald-800'}`}>
        <span className="text-sm font-semibold">{loss ? '▼ Loss' : '▲ Profit'}</span>
        <span className="text-2xl font-bold tabular-nums">{inr(Math.abs(p.profit))}</span>
      </div>
      {p.margin !== null && <div className="-mt-1 px-4 pb-2 text-right text-xs text-stone-500">{Math.round(p.margin * 100)}% of income</div>}
      <div className="grid grid-cols-3 divide-x divide-stone-100 border-t border-stone-100 bg-stone-50 py-2 text-center text-xs tabular-nums">
        <div><div className="font-semibold">{inr(p.collected)}</div><div className="text-stone-500">Collected</div></div>
        <div><div className={`font-semibold ${p.cashProfit < 0 ? 'text-rose-700' : ''}`}>{inr(p.cashProfit)}</div><div className="text-stone-500">Cash profit now</div></div>
        <div><div className="font-semibold">{inr(p.toCollect)}</div><div className="text-stone-500">To collect</div></div>
      </div>
    </section>
  )
}
