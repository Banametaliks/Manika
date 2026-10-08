import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Repo } from './repo'

export function createSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(friendly(res.error.message))
  return res.data
}

function friendly(msg: string): string {
  if (msg.includes('booking_stalls_one_active')) return 'That stall is already booked.'
  if (msg.includes('stalls_exhibition_id_number_key')) return 'A stall with that number already exists.'
  if (msg.includes('violates foreign key')) return 'This record is in use and cannot be deleted.'
  return msg
}

// Numeric columns arrive as strings from PostgREST; convert them once here.
const NUMERIC = ['price', 'area', 'opening_balance', 'gross_amount', 'discount', 'total_amount', 'amount']
function nums<T>(rows: T[]): T[] {
  for (const r of rows as Record<string, unknown>[])
    for (const k of NUMERIC) if (typeof r[k] === 'string') r[k] = Number(r[k])
  return rows
}

export function supabaseRepo(sb: SupabaseClient): Repo {
  const all = async <T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) =>
    nums(check(await q) ?? [])

  return {
    mode: 'supabase',
    listExhibitions: () => all(sb.from('exhibitions').select('*').order('start_date', { ascending: false })),
    listVendors: () => all(sb.from('vendors').select('*').order('name')),
    listAccounts: () => all(sb.from('accounts').select('*').order('name')),

    async loadExhibition(id) {
      const [stalls, bookings, bookingStalls, payments, expenses] = await Promise.all([
        all(sb.from('stalls').select('*').eq('exhibition_id', id)),
        all(sb.from('bookings').select('*').eq('exhibition_id', id)),
        all(sb.from('booking_stalls').select('*').eq('exhibition_id', id)),
        all(sb.from('payments').select('*').eq('exhibition_id', id)),
        all(sb.from('expenses').select('*').eq('exhibition_id', id)),
      ])
      return { stalls, bookings, bookingStalls, payments, expenses } as never
    },

    async vendorHistory(vendorId) {
      const bookings = await all(sb.from('bookings').select('*').eq('vendor_id', vendorId))
      const ids = bookings.map((b) => (b as { id: string }).id)
      const exIds = [...new Set(bookings.map((b) => (b as { exhibition_id: string }).exhibition_id))]
      const [bookingStalls, payments, exhibitions] = await Promise.all([
        ids.length ? all(sb.from('booking_stalls').select('*').in('booking_id', ids)) : [],
        all(sb.from('payments').select('*').eq('vendor_id', vendorId)),
        exIds.length ? all(sb.from('exhibitions').select('*').in('id', exIds)) : [],
      ])
      const stallIds = bookingStalls.map((x) => (x as { stall_id: string }).stall_id)
      const stalls = stallIds.length ? await all(sb.from('stalls').select('*').in('id', stallIds)) : []
      return { bookings, bookingStalls, payments, exhibitions, stalls, expenses: [] } as never
    },

    accountPayments: (accountId) =>
      all(sb.from('payments').select('*').eq('account_id', accountId).order('payment_date')) as never,

    accountExpenses: (accountId) =>
      all(sb.from('expenses').select('*').eq('account_id', accountId).order('expense_date')) as never,

    async insert(table, rows) {
      return nums(check(await sb.from(table).insert(rows as never).select()) ?? []) as never
    },
    async update(table, id, patch) {
      check(await sb.from(table).update(patch as never).eq('id', id))
    },
    async remove(table, id) {
      check(await sb.from(table).delete().eq('id', id))
    },

    async createBooking(b) {
      const row = check(
        await sb.rpc('create_booking', {
          p_exhibition_id: b.exhibition_id,
          p_vendor_id: b.vendor_id,
          p_booking_date: b.booking_date,
          p_discount: b.discount,
          p_notes: b.notes,
          p_stall_ids: b.stall_ids,
        }),
      )
      return nums([row])[0] as never
    },
    async cancelBooking(id) {
      check(await sb.rpc('cancel_booking', { p_booking_id: id }))
    },
    async createPayment(p) {
      return nums([check(await sb.from('payments').insert(p).select().single())])[0] as never
    },
    async deletePayment(id) {
      check(await sb.from('payments').delete().eq('id', id))
    },
    async createExpense(e) {
      return nums([check(await sb.from('expenses').insert(e).select().single())])[0] as never
    },
    async updateExpense(id, patch) {
      check(await sb.from('expenses').update(patch).eq('id', id))
    },
    async deleteExpense(id) {
      check(await sb.from('expenses').delete().eq('id', id))
    },
    listTasks(exhibitionId) {
      const q = sb.from('tasks').select('*')
      return all(exhibitionId ? q.or(`exhibition_id.eq.${exhibitionId},exhibition_id.is.null`) : q.is('exhibition_id', null)) as never
    },
    async createTask(t) {
      return check(await sb.from('tasks').insert(t).select().single()) as never
    },
    async updateTask(id, patch) {
      check(await sb.from('tasks').update(patch).eq('id', id))
    },
    async deleteTask(id) {
      check(await sb.from('tasks').delete().eq('id', id))
    },

    subscribe(onChange) {
      const ch = sb
        .channel('manika-all')
        .on('postgres_changes', { event: '*', schema: 'public' }, () => onChange())
        .subscribe()
      return () => void sb.removeChannel(ch)
    },
  }
}
