import type { Account, Booking, Expense, Payment, Stall } from '../lib/types'
import { addDays, areaFromSize, today } from '../lib/format'
import type { DB } from './local'

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

// ───────────── Sample data ─────────────

/** Sample exhibition used by the automated tests. Never loaded by the app. */
export function sampleData(): DB {
  const t = today()
  const exId = uid()
  const start = addDays(t, 14)
  const db: DB = {
    exhibitions: [{
      id: exId, name: 'Manika Diwali Expo 2026', venue: 'Exhibition Ground', city: 'Pune',
      start_date: start, end_date: addDays(start, 4), is_active: true, created_at: now(),
    }],
    vendors: [], stalls: [], accounts: [], bookings: [], booking_stalls: [], payments: [], expenses: [], tasks: [],
    seq: { booking: 0, receipt: 0, expense: 0 },
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

  const spend = (category: string, payee: string | null, amount: number, mode: Expense['mode'], daysAgo: number) =>
    db.expenses.push({
      id: uid(), voucher_no: ++db.seq.expense, exhibition_id: exId, category, payee, amount,
      expense_date: addDays(t, -daysAgo), mode, account_id: mode === 'cash' ? cash.id : hdfc.id,
      reference: null, notes: null, created_at: now(),
    })
  spend('Venue rent', 'Exhibition Ground Trust', 60000, 'bank', 10)
  spend('Pandal / tent', 'Shree Mandap Decorators', 35000, 'bank', 6)
  spend('Advertising', 'Pune Times', 12000, 'upi', 5)
  spend('Printing', 'Om Printers', 4500, 'cash', 4)
  spend('Food & tea', null, 1200, 'cash', 1)
  return db
}
