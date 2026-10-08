import type {
  Account, Booking, BookingStall, Exhibition, Expense, Payment, Stall, Task, Vendor,
} from '../lib/types'
import type { MasterTable, Repo } from './repo'

/**
 * Demo backend: same behaviour as Supabase, data kept in this browser's localStorage.
 * Used for local development and the preview page. Starts empty; tests pass sample data.
 */

export interface DB {
  exhibitions: Exhibition[]
  vendors: Vendor[]
  stalls: Stall[]
  accounts: Account[]
  bookings: Booking[]
  booking_stalls: BookingStall[]
  payments: Payment[]
  expenses: Expense[]
  tasks: Task[]
  seq: { booking: number; receipt: number; expense: number }
}

const KEY = 'manika-demo-db-v2'
/** Older demo storage that held sample data; removed on first load. */
const OLD_KEYS = ['manika-demo-db-v1']
const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const clone = <T>(x: T): T => structuredClone(x)

export function localRepo(opts: { initial?: () => DB } = {}): Repo {
  try { OLD_KEYS.forEach((k) => localStorage.removeItem(k)) } catch { /* storage blocked */ }
  let db: DB = load()
  const listeners = new Set<() => void>()

  function load(): DB {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return upgrade(JSON.parse(raw))
    } catch { /* fall through to a fresh database */ }
    const seeded = (opts.initial ?? emptyDB)()
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
        expenses: db.expenses.filter((e) => e.exhibition_id === id),
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
        expenses: [],
      })
    },

    accountPayments: async (accountId) =>
      clone(db.payments.filter((p) => p.account_id === accountId)).sort((a, b) => a.payment_date.localeCompare(b.payment_date)),

    accountExpenses: async (accountId) =>
      clone(db.expenses.filter((e) => e.account_id === accountId)).sort((a, b) => a.expense_date.localeCompare(b.expense_date)),

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
        (table === 'accounts' && (db.payments.some((p) => p.account_id === id) || db.expenses.some((e) => e.account_id === id))) ||
        (table === 'exhibitions' && (db.bookings.some((b) => b.exhibition_id === id) || db.expenses.some((e) => e.exhibition_id === id)))
      if (inUse) throw new Error('This record is in use and cannot be deleted.')
      if (table === 'exhibitions') db.stalls = db.stalls.filter((s) => s.exhibition_id !== id)
      if (table === 'exhibitions') db.tasks = db.tasks.filter((t) => t.exhibition_id !== id)
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

    async createExpense(e) {
      if (!(e.amount > 0)) throw new Error('Amount must be more than zero')
      const row: Expense = { ...e, id: uid(), voucher_no: ++db.seq.expense, created_at: now() }
      db.expenses.push(row)
      commit()
      return clone(row)
    },

    async updateExpense(id, patch) {
      const row = db.expenses.find((x) => x.id === id)
      if (!row) throw new Error('Expense not found')
      if (patch.amount !== undefined && !(patch.amount > 0)) throw new Error('Amount must be more than zero')
      Object.assign(row, patch)
      commit()
    },

    async deleteExpense(id) {
      db.expenses = db.expenses.filter((x) => x.id !== id)
      commit()
    },

    listTasks: async (exhibitionId) =>
      clone(db.tasks.filter((t) => t.exhibition_id === null || t.exhibition_id === exhibitionId)),

    async createTask(t) {
      if (!t.title.trim()) throw new Error('Type what needs to be done')
      const row: Task = { ...t, id: uid(), created_at: now() }
      db.tasks.push(row)
      commit()
      return clone(row)
    },

    async updateTask(id, patch) {
      const row = db.tasks.find((x) => x.id === id)
      if (!row) throw new Error('Task not found')
      Object.assign(row, patch)
      commit()
    },

    async deleteTask(id) {
      db.tasks = db.tasks.filter((x) => x.id !== id)
      commit()
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return repo
}

/** Adds what newer versions expect to demo data saved by an older version. */
function upgrade(db: DB): DB {
  db.expenses ??= []
  db.tasks ??= []
  db.seq.expense ??= db.expenses.length
  return db
}

export function resetDemo() {
  localStorage.removeItem(KEY)
}

export function emptyDB(): DB {
  return {
    exhibitions: [], vendors: [], stalls: [], accounts: [], bookings: [], booking_stalls: [], payments: [], expenses: [], tasks: [],
    seq: { booking: 0, receipt: 0, expense: 0 },
  }
}
