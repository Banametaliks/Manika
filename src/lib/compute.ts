import type { Booking, BookingStall, Expense, Payment, Stall, Vendor, ID } from './types'
import { naturalCompare } from './format'

export type StallStatus = 'free' | 'blocked' | 'booked' | 'partial' | 'paid'

export const STATUS_LABEL: Record<StallStatus, string> = {
  free: 'Available',
  blocked: 'Blocked',
  booked: 'Booked · unpaid',
  partial: 'Part paid',
  paid: 'Fully paid',
}

export interface ExhibitionData {
  stalls: Stall[]
  bookings: Booking[]
  bookingStalls: BookingStall[]
  payments: Payment[]
  vendors: Vendor[]
}

export interface BookingInfo {
  booking: Booking
  vendor: Vendor | undefined
  stalls: Stall[]
  paid: number
  balance: number
  payments: Payment[]
}

export interface Index {
  stallById: Map<ID, Stall>
  vendorById: Map<ID, Vendor>
  bookingInfo: Map<ID, BookingInfo>
  /** Active booking holding each stall. */
  bookingByStall: Map<ID, BookingInfo>
  statusByStall: Map<ID, StallStatus>
  /** Active bookings of each vendor in this exhibition. */
  bookingsByVendor: Map<ID, BookingInfo[]>
}

export function buildIndex(d: ExhibitionData): Index {
  const stallById = new Map(d.stalls.map((s) => [s.id, s]))
  const vendorById = new Map(d.vendors.map((v) => [v.id, v]))
  const paymentsByBooking = groupBy(d.payments, (p) => p.booking_id)

  const bookingInfo = new Map<ID, BookingInfo>()
  for (const b of d.bookings) {
    const payments = (paymentsByBooking.get(b.id) ?? []).sort((x, y) =>
      x.payment_date.localeCompare(y.payment_date),
    )
    const paid = sum(payments.map((p) => p.amount))
    bookingInfo.set(b.id, {
      booking: b,
      vendor: vendorById.get(b.vendor_id),
      stalls: [],
      paid,
      balance: b.status === 'active' ? round2(b.total_amount - paid) : 0,
      payments,
    })
  }

  const bookingByStall = new Map<ID, BookingInfo>()
  for (const bs of d.bookingStalls) {
    const info = bookingInfo.get(bs.booking_id)
    const stall = stallById.get(bs.stall_id)
    if (!info || !stall) continue
    if (bs.active || info.booking.status === 'cancelled') info.stalls.push(stall)
    if (bs.active && info.booking.status === 'active') bookingByStall.set(bs.stall_id, info)
  }
  for (const info of bookingInfo.values()) info.stalls.sort((a, b) => naturalCompare(a.number, b.number))

  const statusByStall = new Map<ID, StallStatus>()
  for (const s of d.stalls) statusByStall.set(s.id, stallStatus(s, bookingByStall.get(s.id)))

  const bookingsByVendor = new Map<ID, BookingInfo[]>()
  for (const info of bookingInfo.values()) {
    if (info.booking.status !== 'active') continue
    const list = bookingsByVendor.get(info.booking.vendor_id) ?? []
    list.push(info)
    bookingsByVendor.set(info.booking.vendor_id, list)
  }

  return { stallById, vendorById, bookingInfo, bookingByStall, statusByStall, bookingsByVendor }
}

export function stallStatus(stall: Stall, info: BookingInfo | undefined): StallStatus {
  if (info) {
    if (info.paid <= 0) return 'booked'
    return info.balance <= 0 ? 'paid' : 'partial'
  }
  return stall.blocked ? 'blocked' : 'free'
}

export interface TileSummary {
  tile: string
  total: number
  free: number
  booked: number // any active booking, paid or not
  blocked: number
  fullyPaid: number
  partPaid: number
  unpaid: number
  totalArea: number
  bookedArea: number
  /** e.g. [{size:'3x3', count:10}] */
  sizes: { size: string; count: number; free: number }[]
  value: number // price of all stalls
  bookedValue: number // booking totals for this tile's stalls
  collected: number
  pending: number
}

/**
 * Per-tile figures. Money for a booking that spans tiles is split by each stall's
 * share of the booking's gross price.
 */
export function tileSummaries(stalls: Stall[], idx: Index): TileSummary[] {
  const byTile = groupBy(stalls, (s) => s.tile)
  const out: TileSummary[] = []
  for (const [tile, list] of byTile) {
    const t: TileSummary = {
      tile, total: list.length, free: 0, booked: 0, blocked: 0, fullyPaid: 0, partPaid: 0, unpaid: 0,
      totalArea: 0, bookedArea: 0, sizes: [], value: 0, bookedValue: 0, collected: 0, pending: 0,
    }
    const sizes = new Map<string, { size: string; count: number; free: number }>()
    for (const s of list) {
      const status = idx.statusByStall.get(s.id)!
      const sz = s.size || '—'
      const entry = sizes.get(sz) ?? { size: sz, count: 0, free: 0 }
      entry.count++
      t.totalArea += s.area ?? 0
      t.value += s.price
      if (status === 'free') { t.free++; entry.free++ }
      else if (status === 'blocked') t.blocked++
      else {
        t.booked++
        if (status === 'paid') t.fullyPaid++
        else if (status === 'partial') t.partPaid++
        else t.unpaid++
        t.bookedArea += s.area ?? 0
        const info = idx.bookingByStall.get(s.id)!
        const share = info.booking.gross_amount > 0 ? s.price / info.booking.gross_amount : 1 / info.stalls.length
        t.bookedValue += info.booking.total_amount * share
        t.collected += info.paid * share
        t.pending += info.balance * share
      }
      sizes.set(sz, entry)
    }
    t.sizes = [...sizes.values()].sort((a, b) => naturalCompare(a.size, b.size))
    for (const k of ['bookedValue', 'collected', 'pending'] as const) t[k] = round2(t[k])
    out.push(t)
  }
  return out.sort((a, b) => naturalCompare(a.tile, b.tile))
}

export function totals(tiles: TileSummary[]) {
  const t = { total: 0, free: 0, booked: 0, blocked: 0, fullyPaid: 0, partPaid: 0, unpaid: 0, totalArea: 0, bookedArea: 0, bookedValue: 0, collected: 0, pending: 0 }
  for (const x of tiles) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += x[k]
  return t
}

/** Outstanding balance per vendor (active bookings only), largest first. */
export function outstandingByVendor(idx: Index) {
  const out: { vendor: Vendor; balance: number; bookings: BookingInfo[] }[] = []
  for (const [vid, list] of idx.bookingsByVendor) {
    const vendor = idx.vendorById.get(vid)
    const balance = round2(sum(list.map((b) => b.balance)))
    if (vendor && balance > 0) out.push({ vendor, balance, bookings: list })
  }
  return out.sort((a, b) => b.balance - a.balance)
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
export const round2 = (n: number) => Math.round(n * 100) / 100

export function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const x of xs) {
    const k = key(x)
    const l = m.get(k)
    if (l) l.push(x)
    else m.set(k, [x])
  }
  return m
}

// ───────────── Expenses & profit ─────────────

export const EXPENSE_CATEGORIES = [
  'Venue rent', 'Pandal / tent', 'Electricity', 'Sound & light', 'Advertising', 'Printing',
  'Security', 'Housekeeping', 'Staff wages', 'Food & tea', 'Transport', 'Permissions & fees', 'Other',
]

export interface CategoryTotal { category: string; amount: number; count: number }

/** Expense totals per category, largest first. */
export function expenseBreakdown(expenses: Expense[]): CategoryTotal[] {
  const cats = new Map<string, CategoryTotal>()
  for (const e of expenses) {
    const c = cats.get(e.category) ?? { category: e.category, amount: 0, count: 0 }
    c.amount += e.amount
    c.count++
    cats.set(e.category, c)
  }
  return [...cats.values()].map((c) => ({ ...c, amount: round2(c.amount) })).sort((a, b) => b.amount - a.amount)
}

export interface Profit {
  /** Value of active bookings (after discount). */
  bookingValue: number
  /** Money received on bookings that were later cancelled (kept unless refunded). */
  keptFromCancelled: number
  /** bookingValue + keptFromCancelled */
  income: number
  collected: number
  toCollect: number
  expenses: number
  byCategory: CategoryTotal[]
  /** income − expenses: what the exhibition makes once every vendor pays. */
  profit: number
  /** collected − expenses: cash position right now. */
  cashProfit: number
  /** profit as a share of income, 0–1; null when there is no income yet. */
  margin: number | null
}

export function profitSummary(idx: Index, expenses: Expense[]): Profit {
  let bookingValue = 0, keptFromCancelled = 0, collected = 0, toCollect = 0
  for (const b of idx.bookingInfo.values()) {
    collected += b.paid
    if (b.booking.status === 'active') { bookingValue += b.booking.total_amount; toCollect += b.balance }
    else keptFromCancelled += b.paid
  }
  const spent = round2(sum(expenses.map((e) => e.amount)))
  const income = round2(bookingValue + keptFromCancelled)
  return {
    bookingValue: round2(bookingValue),
    keptFromCancelled: round2(keptFromCancelled),
    income,
    collected: round2(collected),
    toCollect: round2(toCollect),
    expenses: spent,
    byCategory: expenseBreakdown(expenses),
    profit: round2(income - spent),
    cashProfit: round2(collected - spent),
    margin: income > 0 ? (income - spent) / income : null,
  }
}
