export type ID = string

export interface Exhibition {
  id: ID
  name: string
  venue: string | null
  city: string | null
  start_date: string // yyyy-mm-dd
  end_date: string
  is_active: boolean
  created_at: string
}

export interface Vendor {
  id: ID
  name: string
  business_name: string | null
  phone: string | null
  gstin: string | null
  city: string | null
  category: string | null
  notes: string | null
  created_at: string
}

export interface Stall {
  id: ID
  exhibition_id: ID
  number: string
  tile: string
  size: string | null
  area: number | null
  stall_type: string | null
  price: number
  blocked: boolean
  notes: string | null
  created_at: string
}

export type AccountKind = 'bank' | 'cash'

export interface Account {
  id: ID
  kind: AccountKind
  name: string
  bank_name: string | null
  account_no: string | null
  ifsc: string | null
  upi_id: string | null
  opening_balance: number
  is_default: boolean
  created_at: string
}

export interface Booking {
  id: ID
  booking_no: number
  exhibition_id: ID
  vendor_id: ID
  booking_date: string
  gross_amount: number
  discount: number
  total_amount: number
  status: 'active' | 'cancelled'
  notes: string | null
  created_at: string
}

export interface BookingStall {
  id: ID
  booking_id: ID
  exhibition_id: ID
  stall_id: ID
  price: number
  active: boolean
}

export type PaymentMode = 'cash' | 'upi' | 'bank' | 'cheque'

export interface Payment {
  id: ID
  receipt_no: number
  exhibition_id: ID
  booking_id: ID
  vendor_id: ID
  amount: number
  payment_date: string
  mode: PaymentMode
  account_id: ID
  reference: string | null
  notes: string | null
  created_at: string
}

export type Insert<T> = Omit<T, 'id' | 'created_at'>

export interface Expense {
  id: ID
  voucher_no: number
  exhibition_id: ID
  category: string
  payee: string | null
  amount: number
  expense_date: string
  mode: PaymentMode
  account_id: ID
  reference: string | null
  notes: string | null
  created_at: string
}

export interface Task {
  id: ID
  /** null = general task, shown in every exhibition */
  exhibition_id: ID | null
  title: string
  notes: string | null
  assigned_to: string | null
  due_date: string | null
  done: boolean
  done_at: string | null
  done_by: string | null
  created_by: string | null
  created_at: string
}
