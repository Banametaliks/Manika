import type {
  Account, Booking, BookingStall, Exhibition, Expense, ID, Insert, Payment, Stall, Vendor,
} from '../lib/types'

export interface MasterTables {
  exhibitions: Exhibition
  vendors: Vendor
  stalls: Stall
  accounts: Account
}
export type MasterTable = keyof MasterTables

export interface NewBooking {
  exhibition_id: ID
  vendor_id: ID
  booking_date: string
  discount: number
  notes: string | null
  stall_ids: ID[]
}

export type NewPayment = Omit<Insert<Payment>, 'receipt_no'>
export type NewExpense = Omit<Insert<Expense>, 'voucher_no'>

export interface ExhibitionRows {
  stalls: Stall[]
  bookings: Booking[]
  bookingStalls: BookingStall[]
  payments: Payment[]
  expenses: Expense[]
}

export interface Repo {
  readonly mode: 'supabase' | 'demo'

  listExhibitions(): Promise<Exhibition[]>
  listVendors(): Promise<Vendor[]>
  listAccounts(): Promise<Account[]>
  loadExhibition(exhibitionId: ID): Promise<ExhibitionRows>
  /** Bookings and payments of one vendor across every exhibition. */
  vendorHistory(vendorId: ID): Promise<ExhibitionRows & { exhibitions: Exhibition[] }>

  /** Every payment received into one bank / cash account, all exhibitions. */
  accountPayments(accountId: ID): Promise<Payment[]>
  /** Every expense paid from one bank / cash account, all exhibitions. */
  accountExpenses(accountId: ID): Promise<Expense[]>

  insert<T extends MasterTable>(table: T, rows: Insert<MasterTables[T]>[]): Promise<MasterTables[T][]>
  update<T extends MasterTable>(table: T, id: ID, patch: Partial<MasterTables[T]>): Promise<void>
  remove(table: MasterTable, id: ID): Promise<void>

  createBooking(b: NewBooking): Promise<Booking>
  cancelBooking(bookingId: ID): Promise<void>
  createPayment(p: NewPayment): Promise<Payment>
  deletePayment(paymentId: ID): Promise<void>

  createExpense(e: NewExpense): Promise<Expense>
  updateExpense(id: ID, patch: Partial<NewExpense>): Promise<void>
  deleteExpense(id: ID): Promise<void>

  /** Calls back whenever data changes (on this device or another). Returns unsubscribe. */
  subscribe(onChange: () => void): () => void
}
