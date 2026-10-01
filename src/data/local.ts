import type {
  Account, Booking, BookingStall, Exhibition, Payment, Stall, Vendor,
} from '../lib/types'
import { addDays, areaFromSize, today } from '../lib/format'
import type { MasterTable, Repo } from './repo'

/**
 * Demo backend: same behaviour as Supabase, data kept in this browser's localStorage.
 * Used when no Supabase keys are configured so the app can be tried straight away.
 */

interface DB {
  exhibitions: Exhibition[]
  vendors: Vendor[]
  stalls: Stall[]
  accounts: Account[]
  bookings: Booking[]
  booking_stalls: BookingStall[]
  payments: Payment[]
  seq: { booking: number; receipt: number }
}

const KEY = 'manika-demo-db-v1'
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const clone = <T>(x: T): T => structuredClone(x)

export function localRepo(): Repo {
  let db: DB = load()
  const listeners = new Set<() => void>()

  function load(): DB {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return JSON.parse(raw)
    } catch { /* fall through to seed */ }
    const seeded = seed()
    try { localStorage.setItem(KEY, JSON.stringify(seeded)) } catch { /* ignore */ }
    return seeded
  }
  function commit() {
    try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* storage full or blocked */ }
    listeners.forEach((l) => l())
  }

  if (typeof window !== 'undefined')
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) { db = load(); listeners.forEach((l) => l()) }
    })

  const repo: Repo = {
    mode: 'demo',
    listExhibitions: async () => clone(db.exhibitions).sort((a, b) => b.start_date.localeCompare(a.start_date)),
    listVendors: async () => clone(db.vendors).sort((a, b) => a.name.localeCompare(b.name)),
    listAccounts: async () => clone(db.accounts).sort((a, b) => a.name.localeCompare(b.name)),

    async loadExhibition(id) {
      return clone({
        stalls: db.stalls.filter((s) => s.exhibition_id === id),
        bookings: db.bookings.filter((b) => b.exhibition_id === id),
        bookingStalls: db.booking_stalls.filter((b) => b.exhibition_id === id),
        payments: db.payments.filter((p) => p.exhibition_id === id),
      })
    },

    async vendorHistory(vendorId) {
      const bookings = db.bookings.filter((b) => b.vendor_id === vendorId)
      const ids = new Set(bookings.map((b) => b.id))
      const bookingStalls = db.booking_stalls.filter((x) => ids.has(x.booking_id))
      const stallIds = new Set(bookingStalls.map((x) => x.stall_id))
      const exIds = new Set(bookings.map((b) => b.exhibition_id))
      return clone({
        bookings,
        bookingStalls,
        stalls: db.stalls.filter((s) => stallIds.has(s.id)),
        payments: db.payments.filter((p) => p.vendor_id === vendorId),
        exhibitions: db.exhibitions.filter((e) => exIds.has(e.id)),
      })
    },

    accountPayments: async (accountId) =>
      clone(db.payments.filter((p) => p.account_id === accountId)).sort((a, b) => a.payment_date.localeCompare(b.payment_date)),

    async insert(table, rows) {
      if (table === 'stalls') {
        for (const r of rows as unknown as Stall[]) {
          const clash = db.stalls.some((s) => s.exhibition_id === r.exhibition_id && s.number.toLowerCase() === r.number.toLowerCase())
          if (clash) throw new Error(`Stall ${r.number} already exists.`)
        }
      }
      const created = rows.map((r) => ({ ...r, id: uid(), created_at: now() }))
      ;(db[table] as unknown[]).push(...created)
      commit()
      return clone(created) as never
    },

    async update(table, id, patch) {
      const row = (db[table] as { id: string }[]).find((r) => r.id === id)
      if (!row) throw new Error('Record not found')
      Object.assign(row, patch)
      commit()
    },

    async remove(table: MasterTable, id) {
      const inUse =
        (table === 'vendors' && db.bookings.some((b) => b.vendor_id === id)) ||
        (table === 'stalls' && db.booking_stalls.some((b) => b.stall_id === id)) ||
        (table === 'accounts' && db.payments.some((p) => p.account_id === id)) ||
        (table === 'exhibitions' && db.bookings.some((b) => b.exhibition_id === id))
      if (inUse) throw new Error('This record is in use and cannot be deleted.')
      if (table === 'exhibitions') db.stalls = db.stalls.filter((s) => s.exhibition_id !== id)
      ;(db as unknown as Record<string, { id: string }[]>)[table] = (db[table] as { id: string }[]).filter((r) => r.id !== id)
      commit()
    },

    async createBooking(b) {
      if (!b.stall_ids.length) throw new Error('Select at least one stall')
      const stalls = db.stalls.filter((s) => b.stall_ids.includes(s.id) && s.exhibition_id === b.exhibition_id && !s.blocked)
      if (stalls.length !== b.stall_ids.length) throw new Error('One or more stalls are blocked or not part of this exhibition')
      const taken = db.booking_stalls.some((x) => x.active && b.stall_ids.includes(x.stall_id))
      if (taken) throw new Error('One or more stalls were just booked by someone else')
      const gross = stalls.reduce((a, s) => a + s.price, 0)
      if (b.discount < 0 || b.discount > gross) throw new Error(`Discount must be between 0 and ${gross}`)
      const booking: Booking = {
        id: uid(), booking_no: ++db.seq.booking, exhibition_id: b.exhibition_id, vendor_id: b.vendor_id,
        booking_date: b.booking_date, gross_amount: gross, discount: b.discount, total_amount: gross - b.discount,
        status: 'active', notes: b.notes, created_at: now(),
      }
      db.bookings.push(booking)
      for (const s of stalls)
        db.booking_stalls.push({ id: uid(), booking_id: booking.id, exhibition_id: b.exhibition_id, stall_id: s.id, price: s.price, active: true })
      commit()
      return clone(booking)
    },

    async cancelBooking(id) {
      const b = db.bookings.find((x) => x.id === id)
      if (!b) throw new Error('Booking not found')
      b.status = 'cancelled'
      db.booking_stalls.forEach((x) => { if (x.booking_id === id) x.active = false })
      commit()
    },

    async createPayment(p) {
      if (!(p.amount > 0)) throw new Error('Amount must be more than zero')
      const row: Payment = { ...p, id: uid(), receipt_no: ++db.seq.receipt, created_at: now() }
      db.payments.push(row)
      commit()
      return clone(row)
    },

    async deletePayment(id) {
      db.payments = db.payments.filter((p) => p.id !== id)
      commit()
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return repo
}

export function resetDemo() {
  localStorage.removeItem(KEY)
}

// ───────────── Sample data ─────────────

function seed(): DB {
  const t = today()
  const exId = uid()
  const start = addDays(t, 14)
  const db: DB = {
    exhibitions: [{
      id: exId, name: 'Manika Diwali Expo 2026', venue: 'Exhibition Ground', city: 'Pune',
      start_date: start, end_date: addDays(start, 4), is_active: true, created_at: now(),
    }],
    vendors: [], stalls: [], accounts: [], bookings: [], booking_stalls: [], payments: [],
    seq: { booking: 0, receipt: 0 },
  }

  const mkStall = (tile: string, n: number, size: string, price: number, type: string | null = null): Stall => ({
    id: uid(), exhibition_id: exId, number: `${tile}-${n}`, tile, size, area: areaFromSize(size),
    stall_type: type, price, blocked: false, notes: null, created_at: now(),
  })
  for (let i = 1; i <= 12; i++) db.stalls.push(mkStall('A', i, '3x3', i === 1 || i === 12 ? 30000 : 25000, i === 1 || i === 12 ? 'Corner' : null))
  for (let i = 1; i <= 10; i++) db.stalls.push(mkStall('B', i, '3x3', 22000))
  for (let i = 1; i <= 6; i++) db.stalls.push(mkStall('C', i, '3x6', 45000, 'Premium'))
  for (let i = 1; i <= 8; i++) db.stalls.push(mkStall('D', i, '2x2', 15000, 'Food'))
  db.stalls.find((s) => s.number === 'B-10')!.blocked = true

  const vendorNames: [string, string, string, string][] = [
    ['Ramesh Patil', 'Ramesh Textiles', '9822012345', 'Clothing'],
    ['Sai Deshmukh', 'Sai Handicrafts', '9890011122', 'Handicrafts'],
    ['Anita Kulkarni', 'Anita Jewels', '9763344556', 'Jewellery'],
    ['Imran Shaikh', 'Shaikh Home Decor', '9922778899', 'Home decor'],
    ['Priya Joshi', 'Priya Sarees', '9545123123', 'Clothing'],
    ['Vikram Jain', 'Jain Kitchenware', '9011223344', 'Kitchen'],
    ['Sunita More', 'More Snacks', '9370556677', 'Food'],
    ['Kiran Shah', 'Shah Toys', '9850990011', 'Toys'],
  ]
  db.vendors = vendorNames.map(([name, business_name, phone, category]) => ({
    id: uid(), name, business_name, phone, gstin: null, city: 'Pune', category, notes: null, created_at: now(),
  }))

  const cash: Account = { id: uid(), kind: 'cash', name: 'Cash in hand', bank_name: null, account_no: null, ifsc: null, upi_id: null, opening_balance: 0, is_default: true, created_at: now() }
  const hdfc: Account = { id: uid(), kind: 'bank', name: 'HDFC Current', bank_name: 'HDFC Bank', account_no: '50200012345678', ifsc: 'HDFC0000123', upi_id: 'manika@hdfcbank', opening_balance: 0, is_default: true, created_at: now() }
  const sbi: Account = { id: uid(), kind: 'bank', name: 'SBI Savings', bank_name: 'State Bank of India', account_no: '30012345678', ifsc: 'SBIN0001234', upi_id: null, opening_balance: 0, is_default: false, created_at: now() }
  db.accounts = [cash, hdfc, sbi]

  const book = (vendorIdx: number, numbers: string[], discount: number, daysAgo: number, pays: [number, Payment['mode'], number][]) => {
    const stalls = numbers.map((n) => db.stalls.find((s) => s.number === n)!)
    const gross = stalls.reduce((a, s) => a + s.price, 0)
    const b: Booking = {
      id: uid(), booking_no: ++db.seq.booking, exhibition_id: exId, vendor_id: db.vendors[vendorIdx].id,
      booking_date: addDays(t, -daysAgo), gross_amount: gross, discount, total_amount: gross - discount,
      status: 'active', notes: null, created_at: now(),
    }
    db.bookings.push(b)
    for (const s of stalls) db.booking_stalls.push({ id: uid(), booking_id: b.id, exhibition_id: exId, stall_id: s.id, price: s.price, active: true })
    for (const [amount, mode, ago] of pays)
      db.payments.push({
        id: uid(), receipt_no: ++db.seq.receipt, exhibition_id: exId, booking_id: b.id, vendor_id: b.vendor_id,
        amount, payment_date: addDays(t, -ago), mode, account_id: mode === 'cash' ? cash.id : hdfc.id,
        reference: mode === 'cash' ? null : `UTR${Math.floor(Math.random() * 1e9)}`, notes: null, created_at: now(),
      })
  }
  book(0, ['A-1', 'A-2'], 5000, 9, [[25000, 'upi', 9], [25000, 'bank', 2]])
  book(1, ['A-5'], 0, 7, [[10000, 'cash', 7]])
  book(2, ['A-7'], 0, 6, [[25000, 'upi', 6]])
  book(3, ['B-1', 'B-2'], 2000, 5, [])
  book(4, ['C-1'], 0, 4, [[20000, 'cash', 4], [10000, 'upi', 1]])
  book(5, ['B-5'], 0, 3, [[22000, 'bank', 3]])
  book(6, ['D-1'], 0, 2, [[5000, 'cash', 2]])
  return db
}
