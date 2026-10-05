import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../data/store'
import { EXPENSE_CATEGORIES, expenseBreakdown, type CategoryTotal } from '../lib/compute'
import { MODE_LABEL, fmtDate, inr } from '../lib/format'
import type { Expense, PaymentMode } from '../lib/types'
import { ConfirmButton, Empty, Field, Sheet } from '../components/ui'

export default function Expenses() {
  const { exhibition, rows, accounts } = useStore()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Expense | null>(null)
  const byCategory = useMemo(() => expenseBreakdown(rows.expenses), [rows.expenses])
  const total = byCategory.reduce((a, c) => a + c.amount, 0)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...rows.expenses]
      .filter((e) => !needle || [e.category, e.payee, e.reference, e.notes, `#${e.voucher_no}`].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.voucher_no - a.voucher_no)
  }, [rows.expenses, q])

  if (!exhibition) return <Empty>Create an exhibition first in <Link className="underline" to="/masters?tab=exhibitions">Masters</Link>.</Empty>

  return (
    <div className="space-y-4">
      <section className="card flex items-center justify-between px-4 py-3">
        <div>
          <div className="text-xs text-stone-500">Total expenses</div>
          <div className="text-2xl font-bold tabular-nums">{inr(total)}</div>
        </div>
        <div className="text-right text-xs text-stone-500">{rows.expenses.length} voucher{rows.expenses.length === 1 ? '' : 's'}<br />{exhibition.name}</div>
      </section>

      <Link to="/chat?q=expense" className="btn-primary w-full">🧾 Add expense</Link>

      {byCategory.length > 0 && <CategoryBars items={byCategory} total={total} />}

      <section className="space-y-2">
        <h2 className="font-semibold">All expenses <span className="font-normal text-stone-500">· {rows.expenses.length}</span></h2>
        {rows.expenses.length > 5 && <input className="input" placeholder="Search category, paid to, voucher…" value={q} onChange={(e) => setQ(e.target.value)} />}
        {list.length === 0 ? (
          <Empty>{rows.expenses.length ? 'No expenses match.' : <>No expenses yet. Tap <b>Add expense</b> or say “expense electricity 5000 cash” in the chat.</>}</Empty>
        ) : (
          <ul className="card divide-y divide-stone-100">
            {list.map((e) => (
              <li key={e.id}>
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left" onClick={() => setEdit(e)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{e.category}{e.payee ? <span className="font-normal text-stone-500"> · {e.payee}</span> : null}</div>
                    <div className="truncate text-xs text-stone-500">#{e.voucher_no} · {fmtDate(e.expense_date)} · {MODE_LABEL[e.mode]} · {accounts.find((a) => a.id === e.account_id)?.name}</div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{inr(e.amount)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {edit && <ExpenseForm expense={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

/** Where the money went: one bar per category, longest first, value written beside each bar. */
function CategoryBars({ items, total }: { items: CategoryTotal[]; total: number }) {
  const max = items[0]?.amount || 1
  return (
    <section className="card px-4 py-3">
      <h2 className="mb-2 text-sm font-semibold">Where the money went</h2>
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.category} className="text-sm" title={`${c.category}: ${inr(c.amount)} in ${c.count} expense${c.count > 1 ? 's' : ''}`}>
            <div className="flex justify-between gap-2">
              <span className="truncate">{c.category}</span>
              <span className="shrink-0 font-medium tabular-nums">{inr(c.amount)} <span className="text-xs font-normal text-stone-500">{Math.round((c.amount / total) * 100)}%</span></span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-stone-100">
              <div className="h-2 rounded-full bg-brand-700" style={{ width: `${Math.max(2, (c.amount / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ExpenseForm({ expense, onClose }: { expense: Expense; onClose(): void }) {
  const { repo, accounts, rows, refresh } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({
    category: expense.category, payee: expense.payee ?? '', amount: String(expense.amount), expense_date: expense.expense_date,
    mode: expense.mode, account_id: expense.account_id, reference: expense.reference ?? '', notes: expense.notes ?? '',
  })
  const kind = f.mode === 'cash' ? 'cash' : 'bank'
  const accountChoices = accounts.filter((a) => a.kind === kind)
  const categories = [...new Set([...EXPENSE_CATEGORIES, ...rows.expenses.map((e) => e.category)])]

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn(); await refresh(); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const save = () => run(async () => {
    const amount = Number(f.amount)
    if (!f.category.trim()) throw new Error('Category is required')
    if (!(amount > 0)) throw new Error('Enter an amount more than zero')
    if (!accountChoices.some((a) => a.id === f.account_id)) throw new Error(`Pick the ${kind} account it was paid from`)
    await repo.updateExpense(expense.id, {
      category: f.category.trim(), payee: f.payee.trim() || null, amount, expense_date: f.expense_date,
      mode: f.mode, account_id: f.account_id, reference: f.reference.trim() || null, notes: f.notes.trim() || null,
    })
  })

  return (
    <Sheet open onClose={onClose} title={`Expense #${expense.voucher_no}`}>
      <div className="space-y-3">
        <Field label="Category">
          <input id="exp-category" className="input" list="exp-categories" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          <datalist id="exp-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount ₹"><input id="exp-amount" className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><input id="exp-date" type="date" className="input" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
          <Field label="Mode">
            <select id="exp-mode" className="input" value={f.mode} onChange={(e) => {
              const mode = e.target.value as PaymentMode
              const nextKind = mode === 'cash' ? 'cash' : 'bank'
              const keep = accounts.find((a) => a.id === f.account_id)?.kind === nextKind
              const fallback = accounts.filter((a) => a.kind === nextKind).sort((a, b) => Number(b.is_default) - Number(a.is_default))[0]
              setF({ ...f, mode, account_id: keep ? f.account_id : fallback?.id ?? '' })
            }}>
              {(Object.keys(MODE_LABEL) as PaymentMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="Paid from">
            <select id="exp-account" className="input" value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
              {!accountChoices.some((a) => a.id === f.account_id) && <option value="">Choose…</option>}
              {accountChoices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Paid to"><input id="exp-payee" className="input" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></Field>
        {f.mode !== 'cash' && <Field label="Reference (UTR / cheque no.)"><input id="exp-ref" className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>}
        <Field label="Notes"><input id="exp-notes" className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <ConfirmButton disabled={busy} label="Delete" question={`Delete expense #${expense.voucher_no} (${inr(expense.amount)} for ${expense.category})?`} confirmLabel="Delete expense"
            onConfirm={() => void run(() => repo.deleteExpense(expense.id))} />
          <button className="btn-primary flex-1" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </Sheet>
  )
}
