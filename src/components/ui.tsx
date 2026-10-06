import { useEffect, useState, type ReactNode } from 'react'
import { STATUS_LABEL, type StallStatus } from '../lib/compute'
import { canReachServer } from '../data/store'

/**
 * Whether the app can reach its database. navigator.onLine alone is not trusted:
 * some computers (VPNs, virtual network adapters) report offline while the
 * internet works. When the browser says offline, the server is checked, and
 * re-checked every 15 seconds while it stays unreachable.
 */
export function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      clearTimeout(timer)
      const ok = navigator.onLine || (await canReachServer())
      if (!live) return
      setOnline(ok)
      if (!ok) timer = setTimeout(check, 15000)
    }
    const on = () => { clearTimeout(timer); setOnline(true) }
    window.addEventListener('online', on)
    window.addEventListener('offline', check)
    void check()
    return () => { live = false; clearTimeout(timer); window.removeEventListener('online', on); window.removeEventListener('offline', check) }
  }, [])
  return online
}

/** Background, border and text classes for each stall status. */
export const STATUS_STYLE: Record<StallStatus, string> = {
  free: 'bg-emerald-50 border-emerald-400 border-dashed text-emerald-900',
  booked: 'bg-rose-50 border-rose-300 text-rose-900',
  partial: 'bg-amber-50 border-amber-300 text-amber-900',
  paid: 'bg-sky-50 border-sky-300 text-sky-900',
  blocked: 'bg-stone-200 border-stone-300 text-stone-500',
}
export const STATUS_DOT: Record<StallStatus, string> = {
  free: 'bg-emerald-50 border border-dashed border-emerald-500', booked: 'bg-rose-500', partial: 'bg-amber-500', paid: 'bg-sky-500', blocked: 'bg-stone-400',
}
/** Second signal besides colour, so status never depends on colour alone. */
export const STATUS_MARK: Record<StallStatus, string> = { free: '', booked: '!', partial: '½', paid: '✓', blocked: '✕' }

export function Legend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-600">
      {(Object.keys(STATUS_LABEL) as StallStatus[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[s]}`} />
          {STATUS_MARK[s] && <b className="text-stone-500">{STATUS_MARK[s]}</b>}
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose(): void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="pb-safe max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button aria-label="Close" className="rounded-full p-2 text-stone-500 hover:bg-stone-100" onClick={onClose}>✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-stone-100 text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-4 py-2">
          <dt className="text-stone-500">{k}</dt>
          <dd className="text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">{children}</div>
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>
}

/**
 * Two-step button for destructive actions: first tap asks, second tap does it.
 * Used instead of window.confirm(), which some app views block.
 */
export function ConfirmButton({ label, question, confirmLabel, onConfirm, disabled, className = 'btn-danger' }: {
  label: ReactNode
  question: ReactNode
  confirmLabel: string
  onConfirm(): void
  disabled?: boolean
  className?: string
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) return <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>{label}</button>
  return (
    <div role="alertdialog" className="basis-full rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-200">
      <p className="mb-2">{question}</p>
      <div className="flex gap-2">
        <button type="button" className="btn flex-1 bg-rose-600 text-white" disabled={disabled} onClick={() => { setAsking(false); onConfirm() }}>{confirmLabel}</button>
        <button type="button" className="btn-ghost flex-1" onClick={() => setAsking(false)}>Keep it</button>
      </div>
    </div>
  )
}
