import { Link } from 'react-router-dom'
import { useStore } from '../data/store'
import { profitSummary, totals, type TileSummary } from '../lib/compute'
import { fmtDate, inr, inrShort, today } from '../lib/format'
import { Empty } from '../components/ui'
import { ProfitCard } from './Expenses'

export default function Dashboard() {
  const { exhibition, tiles, rows, idx } = useStore()
  if (!exhibition)
    return <Empty>No exhibition yet. Go to <Link className="font-semibold text-brand-800 underline" to="/masters">Masters</Link> to create one and add stalls.</Empty>

  const t = totals(tiles)
  const todayPay = rows.payments.filter((p) => p.payment_date === today())
  const todayCash = todayPay.filter((p) => p.mode === 'cash').reduce((a, p) => a + p.amount, 0)
  const todayBank = todayPay.filter((p) => p.mode !== 'cash').reduce((a, p) => a + p.amount, 0)
  const sellable = t.total - t.blocked

  return (
    <div className="space-y-4">
      <div className="text-sm text-stone-500">
        {[exhibition.venue, exhibition.city].filter(Boolean).join(', ')} · {fmtDate(exhibition.start_date)} – {fmtDate(exhibition.end_date, true)}
      </div>

      <section className="grid grid-cols-3 gap-2">
        <Stat label="Stalls" value={t.total} sub={t.totalArea ? `${fmt(t.totalArea)} sq m` : undefined} />
        <Stat label="Booked" value={t.booked} sub={sellable ? `${Math.round((t.booked / sellable) * 100)}% sold` : undefined} />
        <Stat label="Available" value={t.free} sub={t.blocked ? `${t.blocked} blocked` : undefined} />
        <Stat label="Booking value" value={inrShort(t.bookedValue)} />
        <Stat label="Collected" value={inrShort(t.collected)} />
        <Stat label="Pending" value={inrShort(t.pending)} alert={t.pending > 0} />
      </section>

      <section className="card flex items-center justify-between px-4 py-3 text-sm">
        <span className="text-stone-500">Today’s collection</span>
        <span className="font-semibold">
          {inr(todayCash + todayBank)} <span className="font-normal text-stone-500">· cash {inrShort(todayCash)} · bank {inrShort(todayBank)}</span>
        </span>
      </section>

      <Link to="/expenses" className="block active:scale-[.99]" aria-label="Profit and expenses">
        <ProfitCard p={profitSummary(idx, rows.expenses)} compact />
      </Link>

      <div className="flex gap-2">
        <Link to="/chat?q=book" className="btn-primary flex-1">🏷️ Book stall</Link>
        <Link to="/chat?q=pay" className="btn-primary flex-1">💰 Payment</Link>
      </div>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Tiles</h2>
          <BarKey />
        </div>
        {tiles.length === 0 ? (
          <Empty>No stalls yet. Add them in <Link className="font-semibold text-brand-800 underline" to="/masters">Masters → Stalls</Link>.</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            {tiles.map((x) => <TileCard key={x.tile} t={x} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function TileCard({ t }: { t: TileSummary }) {
  const due = t.unpaid + t.partPaid
  return (
    <Link to={`/tile/${encodeURIComponent(t.tile)}`} className="card block p-4 transition active:scale-[.99]">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Tile</div>
          <div className="text-2xl font-bold leading-none">{t.tile}</div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{t.total} stalls</div>
          {t.totalArea > 0 && <div className="text-xs text-stone-500">{fmt(t.totalArea)} sq m</div>}
        </div>
      </div>

      <ProgressBar t={t} />

      <div className="mt-2 grid grid-cols-3 text-center text-xs">
        <div><div className="text-base font-semibold">{t.booked}</div><div className="text-stone-500">Booked</div></div>
        <div><div className="text-base font-semibold">{t.free}</div><div className="text-stone-500">Available</div></div>
        <div><div className="text-base font-semibold">{inrShort(t.pending)}</div><div className="text-stone-500">Pending</div></div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {t.sizes.map((s) => (
          <span key={s.size} className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600">
            {s.size} × {s.count} <span className="text-stone-400">({s.free} free)</span>
          </span>
        ))}
      </div>
      {due > 0 && <div className="mt-2 text-[11px] text-stone-500">{due} booked stall{due > 1 ? 's' : ''} with payment due</div>}
    </Link>
  )
}

/** Booked share of the tile, split by payment state; the empty track is what's still available. */
function ProgressBar({ t }: { t: TileSummary }) {
  const segs = [
    { n: t.fullyPaid, cls: 'bg-sky-500', label: 'fully paid' },
    { n: t.partPaid, cls: 'bg-amber-500', label: 'part paid' },
    { n: t.unpaid, cls: 'bg-rose-500', label: 'unpaid' },
  ].filter((s) => s.n > 0)
  return (
    <div
      className="mt-3 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-stone-200"
      role="img"
      aria-label={`${t.booked} of ${t.total} booked: ${segs.map((s) => `${s.n} ${s.label}`).join(', ') || 'none'}`}
    >
      {segs.map((s) => (
        <div key={s.label} title={`${s.n} ${s.label}`} className={`${s.cls} h-full first:rounded-l-full`} style={{ width: `${(s.n / t.total) * 100}%` }} />
      ))}
    </div>
  )
}

function BarKey() {
  return (
    <div className="flex gap-2 text-[11px] text-stone-500">
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-sky-500" />Paid</span>
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" />Part</span>
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-rose-500" />Unpaid</span>
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-stone-200" />Free</span>
    </div>
  )
}

function Stat({ label, value, sub, alert }: { label: string; value: string | number; sub?: string; alert?: boolean }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[11px] font-medium text-stone-500">{label}</div>
      <div className={`text-lg font-bold leading-tight ${alert ? 'text-rose-700' : ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-stone-500">{sub}</div>}
    </div>
  )
}

const fmt = (n: number) => String(Math.round(n * 10) / 10)
