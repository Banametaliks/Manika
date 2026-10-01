import type { Account, PaymentMode, Stall, Vendor } from '../lib/types'
import { MODE_LABEL, addDays, dateRange, fmtDate, inr, inrShort, naturalCompare, parseDate, today } from '../lib/format'
import { STATUS_LABEL, outstandingByVendor, round2, type BookingInfo } from '../lib/compute'
import type { Card, Chip, Ctx, Flow, Prompt, Router, Step } from './engine'
import {
  accountKindFor, findStalls, isNo, matchAccount, matchVendors, parseAmount, parseMode,
} from './parse'
import { bookingShareText, receiptShareText, waLink } from '../lib/share'

// ───────────── Shared step builders ─────────────

interface PayFields {
  amount?: number
  mode?: PaymentMode
  accountId?: string
  payDate?: string
  reference?: string | null
}

const MODE_CHIPS: Chip[] = [
  { label: '💵 Cash', value: 'cash' },
  { label: '📱 UPI', value: 'upi' },
  { label: '🏦 Bank transfer', value: 'bank' },
  { label: '🧾 Cheque', value: 'cheque' },
]

function dateChips(ctx: Ctx, includeShowDays: boolean): Chip[] {
  const t = today()
  const chips: Chip[] = [
    { label: `Today · ${fmtDate(t)}`, value: t, tone: 'primary' },
    { label: `Yesterday · ${fmtDate(addDays(t, -1))}`, value: addDays(t, -1) },
  ]
  const ex = ctx.exhibition
  if (includeShowDays && ex)
    for (const d of dateRange(ex.start_date, ex.end_date))
      if (d !== t && d !== addDays(t, -1) && d <= t) chips.push({ label: fmtDate(d), value: d })
  return chips
}

function payDateStep<V extends PayFields>(skip?: (v: V) => boolean): Step<V> {
  return {
    key: 'payDate', label: 'Payment date',
    skip, done: (v) => !!v.payDate,
    ask: (_v, ctx) => ({ text: 'Payment date?', chips: dateChips(ctx, true), input: 'date', placeholder: 'e.g. 16/10 or 16 Oct' }),
    answer(input, v) {
      const d = parseDate(input)
      if (!d) return 'I could not read that date. Try 16/10, 16 Oct or tap a chip.'
      if (d > today()) return 'Payment date cannot be in the future.'
      v.payDate = d
    },
    clear: (v) => { v.payDate = undefined },
  }
}

function modeStep<V extends PayFields>(skip?: (v: V) => boolean): Step<V> {
  return {
    key: 'mode', label: 'Payment mode',
    skip, done: (v) => !!v.mode,
    ask: () => ({ text: 'How was it paid?', chips: MODE_CHIPS }),
    answer(input, v) {
      const m = parseMode(input)
      if (!m) return 'Please choose Cash, UPI, Bank transfer or Cheque.'
      if (v.mode !== m) v.accountId = undefined
      v.mode = m
    },
    clear: (v) => { v.mode = undefined; v.accountId = undefined; v.reference = undefined },
  }
}

function accountsFor(ctx: Ctx, mode: PaymentMode): Account[] {
  const kind = accountKindFor(mode)
  return ctx.accounts.filter((a) => a.kind === kind).sort((a, b) => Number(b.is_default) - Number(a.is_default))
}

function accountStep<V extends PayFields>(skip?: (v: V) => boolean): Step<V> {
  return {
    key: 'account', label: 'Received in',
    skip, done: (v) => !!v.accountId,
    auto(v, ctx) {
      const list = accountsFor(ctx, v.mode!)
      if (list.length === 1) v.accountId = list[0].id
      return list.length === 1
    },
    ask(v, ctx) {
      const list = accountsFor(ctx, v.mode!)
      if (!list.length)
        return {
          text: `There is no ${accountKindFor(v.mode!)} account yet. Add one in Masters, then try again.`,
          chips: [{ label: 'Open Masters', to: '/masters' }, { label: 'Cancel', value: '__cancel', tone: 'danger' }],
        }
      return { text: v.mode === 'cash' ? 'Which cash book?' : 'Received in which bank account?', chips: list.map((a) => ({ label: a.name, value: `acc:${a.id}`, sub: a.bank_name ?? undefined })) }
    },
    answer(input, v, ctx) {
      const list = accountsFor(ctx, v.mode!)
      const acc = input.startsWith('acc:') ? list.find((a) => `acc:${a.id}` === input) : matchAccount(input, list)
      if (!acc) return 'Please pick one of the accounts.'
      v.accountId = acc.id
    },
    clear: (v) => { v.accountId = undefined },
  }
}

function referenceStep<V extends PayFields>(skip?: (v: V) => boolean): Step<V> {
  return {
    key: 'reference', label: 'Reference no.',
    skip: (v) => (skip?.(v) ?? false) || v.mode === 'cash',
    done: (v) => v.reference !== undefined,
    ask: (v) => ({
      text: v.mode === 'cheque' ? 'Cheque number (and bank)?' : 'UTR / transaction ID? (optional)',
      chips: [{ label: 'Skip', value: '__skip' }],
    }),
    answer(input, v) { v.reference = input === '__skip' || isNo(input) ? null : input },
    clear: (v) => { v.reference = undefined },
  }
}

/** Amount chips: full balance, half, and a couple of round figures below it. */
function amountChips(balance: number): Chip[] {
  const chips: Chip[] = [{ label: `Full · ${inr(balance)}`, value: String(balance), tone: 'primary' }]
  const half = Math.round(balance / 2)
  if (half > 0 && half < balance) chips.push({ label: `Half · ${inr(half)}`, value: String(half) })
  for (const r of [5000, 10000, 25000, 50000]) if (r < balance && r !== half) chips.push({ label: inr(r), value: String(r) })
  return chips.slice(0, 5)
}

function vendorLabel(v: Vendor) {
  return v.business_name && v.business_name !== v.name ? `${v.name} · ${v.business_name}` : v.name
}

const stallList = (stalls: Stall[]) => stalls.map((s) => s.number).join(', ')

// ───────────── Book stall ─────────────

interface BookV extends PayFields {
  vendorId?: string
  newVendor?: { name?: string; phone?: string | null; business?: string | null }
  tile?: string
  stallIds: string[]
  stallsDone: boolean
  discount?: number
  date?: string
  advance?: number
}

const freeStalls = (ctx: Ctx, tile?: string) =>
  ctx.rows.stalls
    .filter((s) => ctx.idx.statusByStall.get(s.id) === 'free' && (!tile || s.tile === tile))
    .sort((a, b) => naturalCompare(a.number, b.number))

const gross = (v: BookV, ctx: Ctx) => v.stallIds.reduce((a, id) => a + (ctx.idx.stallById.get(id)?.price ?? 0), 0)
const bookTotal = (v: BookV, ctx: Ctx) => gross(v, ctx) - (v.discount ?? 0)
const noAdvance = (v: BookV) => !v.advance

function vendorStep<V extends { vendorId?: string; newVendor?: BookV['newVendor'] }>(opts: {
  question: string
  chips(ctx: Ctx): Chip[]
  allowNew: boolean
  validate?(vendor: Vendor, ctx: Ctx): string | void
}): Step<V> {
  return {
    key: 'vendor', label: 'Vendor',
    done: (v) => !!v.vendorId || !!v.newVendor,
    ask: (_v, ctx) => ({
      text: opts.question,
      chips: [...opts.chips(ctx), ...(opts.allowNew ? [{ label: '➕ New vendor', value: '__new' }] : [])],
      placeholder: 'Type name, shop or mobile…',
    }),
    answer(input, v, ctx) {
      if (opts.allowNew && input.startsWith('__new')) {
        v.newVendor = { name: input.slice(6) || undefined }
        return
      }
      let vendor = input.startsWith('v:') ? ctx.vendors.find((x) => `v:${x.id}` === input) : undefined
      if (!vendor) {
        const hits = matchVendors(input, ctx.vendors)
        if (hits.length === 1) vendor = hits[0]
        else if (hits.length > 1)
          return { text: `Found ${hits.length} vendors. Which one?`, chips: hits.slice(0, 8).map((x) => ({ label: vendorLabel(x), value: `v:${x.id}`, sub: x.phone ?? undefined })) }
        else
          return {
            text: `No vendor matches “${input}”.`,
            chips: opts.allowNew
              ? [{ label: `➕ Add “${input}” as new vendor`, value: `__new:${input}`, tone: 'primary' }, ...opts.chips(ctx)]
              : opts.chips(ctx),
          }
      }
      const err = opts.validate?.(vendor, ctx)
      if (err) return { text: err, chips: opts.chips(ctx) }
      v.vendorId = vendor.id
    },
    clear: (v) => { v.vendorId = undefined; v.newVendor = undefined },
  }
}

function recentVendorChips(ctx: Ctx): Chip[] {
  // Vendors without a booking in this exhibition first: they are the ones likely to book.
  const booked = new Set(ctx.idx.bookingsByVendor.keys())
  return [...ctx.vendors]
    .sort((a, b) => Number(booked.has(a.id)) - Number(booked.has(b.id)) || b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map((v) => ({ label: v.name, value: `v:${v.id}`, sub: v.business_name ?? undefined }))
}

export const bookFlow: Flow<BookV> = {
  id: 'book',
  title: 'Book stall',
  init(ctx, prefill) {
    if (!ctx.exhibition) return 'Create an exhibition first (Masters → Exhibitions).'
    if (!freeStalls(ctx).length) return 'No stalls are available in this exhibition.'
    const v: BookV = { stallIds: [], stallsDone: false }
    if (!prefill) return v
    const { found, rest } = findStalls(prefill, ctx.rows.stalls)
    const free = found.filter((s) => ctx.idx.statusByStall.get(s.id) === 'free')
    if (free.length) {
      v.stallIds = free.map((s) => s.id)
      v.tile = free[0].tile
      v.stallsDone = free.length === found.length
    }
    const words = rest.split(/\s+/).filter((w) => !/^(for|to|stall|stalls|book|booking)$/i.test(w)).join(' ')
    if (words) {
      const hits = matchVendors(words, ctx.vendors)
      if (hits.length === 1) v.vendorId = hits[0].id
    }
    return v
  },
  steps: [
    vendorStep<BookV>({ question: 'Who is booking? Pick a vendor or type a name.', chips: recentVendorChips, allowNew: true }),
    {
      key: 'nvName',
      skip: (v) => !v.newVendor, done: (v) => !!v.newVendor?.name,
      ask: () => ({ text: 'New vendor’s full name?' }),
      answer(input, v) {
        if (input.length < 2) return 'Please type the name.'
        v.newVendor!.name = input
      },
    },
    {
      key: 'nvPhone',
      skip: (v) => !v.newVendor, done: (v) => v.newVendor?.phone !== undefined,
      ask: () => ({ text: 'Mobile number? (used for WhatsApp receipts)', input: 'tel', chips: [{ label: 'Skip', value: '__skip' }] }),
      answer(input, v, ctx) {
        if (input.startsWith('__use:')) { v.vendorId = input.slice(6); v.newVendor = undefined; return }
        if (input === '__retype') return 'Type the mobile number.'
        if (input === '__skip' || isNo(input)) { v.newVendor!.phone = null; return }
        const digits = input.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
        if (digits.length !== 10) return 'Please enter a 10-digit mobile number, or Skip.'
        const dup = ctx.vendors.find((x) => x.phone?.replace(/\D/g, '').endsWith(digits))
        if (dup) return { text: `${digits} is already saved for ${vendorLabel(dup)}. Use that vendor?`, chips: [{ label: `Yes, ${dup.name}`, value: `__use:${dup.id}`, tone: 'primary' }, { label: 'Different number', value: '__retype' }] }
        v.newVendor!.phone = digits
      },
    },
    {
      key: 'nvBusiness',
      skip: (v) => !v.newVendor, done: (v) => v.newVendor?.business !== undefined,
      ask: () => ({ text: 'Business / shop name?', chips: [{ label: 'Same as name', value: '__same' }, { label: 'Skip', value: '__skip' }] }),
      answer(input, v) {
        v.newVendor!.business = input === '__skip' ? null : input === '__same' ? v.newVendor!.name! : input
      },
    },
    {
      key: 'tile', label: 'Stalls',
      done: (v) => !!v.tile,
      ask(v, ctx) {
        const tiles = new Map<string, number>()
        for (const s of freeStalls(ctx)) if (!v.stallIds.includes(s.id)) tiles.set(s.tile, (tiles.get(s.tile) ?? 0) + 1)
        return {
          text: v.stallIds.length ? 'Which tile for the next stall?' : 'Which tile?',
          chips: [...tiles].sort((a, b) => naturalCompare(a[0], b[0])).map(([t, n]) => ({ label: `Tile ${t}`, value: `tile:${t}`, sub: `${n} free` })),
          placeholder: 'Or type stall numbers, e.g. A-3 A-4',
        }
      },
      answer(input, v, ctx) {
        const tiles = [...new Set(ctx.rows.stalls.map((s) => s.tile))]
        const typed = input.replace(/^tile[:\s]*/i, '')
        const tile = tiles.find((t) => t.toLowerCase() === typed.toLowerCase())
        if (tile) { v.tile = tile; return }
        // Stall numbers typed straight away.
        return addTypedStalls(input, v, ctx) ?? undefined
      },
      clear: (v) => { v.tile = undefined; v.stallIds = []; v.stallsDone = false; v.discount = undefined; v.advance = undefined },
    },
    {
      key: 'stalls',
      done: (v) => v.stallsDone,
      ask(v, ctx) {
        const free = freeStalls(ctx, v.tile).filter((s) => !v.stallIds.includes(s.id))
        const chosen = v.stallIds.map((id) => ctx.idx.stallById.get(id)!)
        const chips: Chip[] = free.map((s) => ({ label: s.number, value: `s:${s.id}`, sub: [s.size, inrShort(s.price), s.stall_type].filter(Boolean).join(' · ') }))
        if (chosen.length) {
          chips.unshift({ label: `✓ Done (${chosen.length})`, value: '__done', tone: 'primary' })
          chips.splice(1, 0, { label: 'Another tile', value: '__tile' })
        }
        return {
          text: chosen.length
            ? `Selected ${stallList(chosen)} · ${inr(gross(v, ctx))}. Add more stalls or tap Done.`
            : free.length ? `Free stalls in tile ${v.tile}:` : `No free stalls left in tile ${v.tile}.`,
          chips,
          placeholder: 'Type stall numbers, e.g. A-3 A-4',
        }
      },
      answer(input, v, ctx) {
        if (input === '__done' || /^(done|that'?s all|no more|ok)$/i.test(input)) {
          if (!v.stallIds.length) return 'Pick at least one stall.'
          v.stallsDone = true
          return
        }
        if (input === '__tile') { v.tile = undefined; return }
        if (input.startsWith('s:')) {
          const id = input.slice(2)
          if (ctx.idx.statusByStall.get(id) !== 'free') return 'That stall was just taken. Pick another.'
          if (!v.stallIds.includes(id)) v.stallIds.push(id)
          return
        }
        return addTypedStalls(input, v, ctx) ?? undefined
      },
    },
    {
      key: 'discount', label: 'Discount',
      done: (v) => v.discount !== undefined,
      ask(v, ctx) {
        const g = gross(v, ctx)
        const chips: Chip[] = [{ label: 'No discount', value: '0', tone: 'primary' }]
        for (const amt of [500, 1000, 2000, 5000]) if (amt < g) chips.push({ label: inr(amt), value: String(amt) })
        chips.push({ label: '5%', value: '5%' }, { label: '10%', value: '10%' })
        const stalls = v.stallIds.map((id) => ctx.idx.stallById.get(id)!)
        return { text: `${stallList(stalls)}: total ${inr(g)}. Any discount?`, chips, input: 'number', placeholder: 'Amount or %' }
      },
      answer(input, v, ctx) {
        const g = gross(v, ctx)
        let d: number | null
        if (isNo(input)) d = 0
        else if (/%\s*$/.test(input)) {
          const p = parseAmount(input.replace('%', ''))
          d = p === null ? null : round2((g * p) / 100)
        } else d = parseAmount(input)
        if (d === null) return 'Type an amount like 2000, a percent like 5%, or tap No discount.'
        if (d < 0 || d > g) return `Discount must be between ₹0 and ${inr(g)}.`
        v.discount = d
        if (v.advance !== undefined && v.advance > g - d) v.advance = undefined
      },
      clear: (v) => { v.discount = undefined },
    },
    {
      key: 'date', label: 'Booking date',
      done: (v) => !!v.date,
      ask: (_v, ctx) => ({ text: 'Booking date?', chips: dateChips(ctx, false), input: 'date', placeholder: 'e.g. 28/9' }),
      answer(input, v) {
        const d = parseDate(input)
        if (!d) return 'I could not read that date. Try 28/9, 28 Sep or tap a chip.'
        v.date = d
      },
      clear: (v) => { v.date = undefined },
    },
    {
      key: 'advance', label: 'Advance',
      done: (v) => v.advance !== undefined,
      ask(v, ctx) {
        const total = bookTotal(v, ctx)
        return {
          text: `Booking amount ${inr(total)}. Any advance received now?`,
          chips: [{ label: 'No advance', value: '0' }, ...amountChips(total)],
          input: 'number',
        }
      },
      answer(input, v, ctx) {
        const a = isNo(input) ? 0 : parseAmount(input)
        if (a === null) return 'Type an amount, or tap No advance.'
        if (a > bookTotal(v, ctx)) return `Advance cannot be more than ${inr(bookTotal(v, ctx))}.`
        v.advance = a
        if (!a) { v.mode = undefined; v.accountId = undefined; v.payDate = undefined; v.reference = undefined }
        else v.payDate ??= v.date
      },
      clear: (v) => { v.advance = undefined },
    },
    modeStep<BookV>(noAdvance),
    accountStep<BookV>(noAdvance),
    referenceStep<BookV>(noAdvance),
  ],
  summary(v, ctx) {
    const stalls = v.stallIds.map((id) => ctx.idx.stallById.get(id)!)
    const vendor = v.vendorId ? ctx.idx.vendorById.get(v.vendorId) : undefined
    const rows: [string, string][] = [
      ['Vendor', vendor ? vendorLabel(vendor) : `${v.newVendor?.name} (new)`],
      ['Stalls', stalls.map((s) => `${s.number}${s.size ? ` (${s.size})` : ''}`).join(', ')],
      ['Price', inr(gross(v, ctx))],
    ]
    if (v.discount) rows.push(['Discount', `− ${inr(v.discount)}`])
    rows.push(['Total', inr(bookTotal(v, ctx))], ['Booking date', fmtDate(v.date!)])
    if (v.advance) {
      rows.push(['Advance', `${inr(v.advance)} · ${MODE_LABEL[v.mode!]}`])
      const acc = ctx.accounts.find((a) => a.id === v.accountId)
      if (acc) rows.push(['Received in', acc.name])
      if (v.reference) rows.push(['Reference', v.reference])
      rows.push(['Balance', inr(bookTotal(v, ctx) - v.advance)])
    }
    return { title: `New booking · ${ctx.exhibition?.name ?? ''}`, rows }
  },
  async commit(v, ctx) {
    const ex = ctx.exhibition!
    let vendorId = v.vendorId
    if (!vendorId) {
      const nv = v.newVendor!
      const [created] = await ctx.repo.insert('vendors', [{
        name: nv.name!, business_name: nv.business ?? null, phone: nv.phone ?? null,
        gstin: null, city: ex.city, category: null, notes: null,
      }])
      vendorId = created.id
      v.vendorId = vendorId
      v.newVendor = undefined
    }
    const booking = await ctx.repo.createBooking({
      exhibition_id: ex.id, vendor_id: vendorId, booking_date: v.date!, discount: v.discount ?? 0, notes: null, stall_ids: v.stallIds,
    })
    let receiptNo: number | null = null
    if (v.advance) {
      const p = await ctx.repo.createPayment({
        exhibition_id: ex.id, booking_id: booking.id, vendor_id: vendorId, amount: v.advance,
        payment_date: v.payDate ?? v.date!, mode: v.mode!, account_id: v.accountId!, reference: v.reference ?? null, notes: 'Advance at booking',
      })
      receiptNo = p.receipt_no
    }
    await ctx.refresh()
    const vendor = (await ctx.repo.listVendors()).find((x) => x.id === vendorId)!
    const stalls = v.stallIds.map((id) => ctx.idx.stallById.get(id)!)
    const paid = v.advance ?? 0
    const share = bookingShareText({ exhibition: ex, booking, vendor, stalls, paid })
    const rows: [string, string][] = [
      ['Vendor', vendorLabel(vendor)],
      ['Stalls', stallList(stalls)],
      ['Total', inr(booking.total_amount)],
      ['Paid', inr(paid)],
      ['Balance', inr(booking.total_amount - paid)],
    ]
    if (receiptNo) rows.push(['Receipt', `#${receiptNo}`])
    return {
      text: `✅ Booking #${booking.booking_no} saved.`,
      card: { title: `Booking #${booking.booking_no}`, rows, tone: 'success' },
      chips: [
        { label: '📤 Share on WhatsApp', href: waLink(vendor.phone, share), tone: 'primary' },
        { label: 'Book another', value: 'book' },
        { label: 'Record payment', value: 'pay' },
        { label: 'Menu', value: '__menu' },
      ],
    }
  },
}

function addTypedStalls(input: string, v: BookV, ctx: Ctx): string | void {
  const { found } = findStalls(input, ctx.rows.stalls)
  if (!found.length) return `I could not find a stall “${input}”. Tap a stall or type its number, e.g. ${freeStalls(ctx)[0]?.number ?? 'A-1'}.`
  const notFree = found.filter((s) => ctx.idx.statusByStall.get(s.id) !== 'free')
  if (notFree.length)
    return notFree.map((s) => `${s.number} is ${ctx.idx.statusByStall.get(s.id) === 'blocked' ? 'blocked' : `already booked by ${ctx.idx.bookingByStall.get(s.id)?.vendor?.name ?? 'someone'}`}`).join('; ') + '. Pick free stalls.'
  for (const s of found) if (!v.stallIds.includes(s.id)) v.stallIds.push(s.id)
  v.tile = found[found.length - 1].tile
}

// ───────────── Record payment ─────────────

interface PayV extends PayFields {
  vendorId?: string
  bookingId?: string
}

const dueBookings = (ctx: Ctx, vendorId: string) =>
  (ctx.idx.bookingsByVendor.get(vendorId) ?? []).filter((b) => b.balance > 0).sort((a, b) => a.booking.booking_no - b.booking.booking_no)

const bookingLabel = (b: BookingInfo) => `#${b.booking.booking_no} · ${stallList(b.stalls)}`

function dueVendorChips(ctx: Ctx): Chip[] {
  return outstandingByVendor(ctx.idx).slice(0, 8).map((o) => ({ label: o.vendor.name, value: `v:${o.vendor.id}`, sub: `Due ${inrShort(o.balance)}` }))
}

export const payFlow: Flow<PayV> = {
  id: 'pay',
  title: 'Record payment',
  init(ctx, prefill) {
    if (!ctx.exhibition) return 'Create an exhibition first (Masters → Exhibitions).'
    if (!outstandingByVendor(ctx.idx).length) return '🎉 Nobody has a pending balance in this exhibition.'
    const v: PayV = {}
    if (!prefill) return v
    // "pay ramesh 10000 upi hdfc yesterday" — pick out what we can, ask for the rest.
    const left: string[] = []
    const { found, rest } = findStalls(prefill, ctx.rows.stalls)
    for (const w of rest.split(/\s+/).filter(Boolean)) {
      const mode = parseMode(w)
      const amt = parseAmount(w)
      const d = /[a-z]/i.test(w) || w.includes('/') ? parseDate(w) : null
      if (mode && !v.mode) v.mode = mode
      else if (d && !v.payDate && d <= today()) v.payDate = d
      else if (amt !== null && amt > 0 && v.amount === undefined && !/^\d{10}$/.test(w)) v.amount = amt
      else if (!/^(rs|from|by|via|in|of|received|paid|payment)$/i.test(w)) left.push(w)
    }
    const stallBooking = found.length ? ctx.idx.bookingByStall.get(found[0].id) : undefined
    if (stallBooking) { v.vendorId = stallBooking.booking.vendor_id; if (stallBooking.balance > 0) v.bookingId = stallBooking.booking.id }
    const words = left.join(' ')
    if (!v.vendorId && words) {
      const hits = matchVendors(words, ctx.vendors).filter((x) => dueBookings(ctx, x.id).length)
      if (hits.length === 1) v.vendorId = hits[0].id
    }
    if (v.mode && words) {
      const acc = matchAccount(words, accountsFor(ctx, v.mode))
      if (acc) v.accountId = acc.id
    }
    if (v.vendorId && !dueBookings(ctx, v.vendorId).length) v.vendorId = undefined
    return v
  },
  steps: [
    vendorStep<PayV>({
      question: 'Payment from whom?',
      chips: dueVendorChips,
      allowNew: false,
      validate: (vendor, ctx) => (dueBookings(ctx, vendor.id).length ? undefined : `${vendor.name} has no pending balance in this exhibition.`),
    }),
    {
      key: 'booking', label: 'Booking',
      done: (v) => !!v.bookingId,
      auto(v, ctx) {
        const list = dueBookings(ctx, v.vendorId!)
        if (list.length === 1) v.bookingId = list[0].booking.id
        return list.length === 1
      },
      ask: (v, ctx) => ({
        text: 'Against which booking?',
        chips: dueBookings(ctx, v.vendorId!).map((b) => ({ label: bookingLabel(b), value: `b:${b.booking.id}`, sub: `Due ${inr(b.balance)}` })),
      }),
      answer(input, v, ctx) {
        const list = dueBookings(ctx, v.vendorId!)
        const b = list.find((x) => `b:${x.booking.id}` === input) ?? list.find((x) => findStalls(input, x.stalls).found.length)
        if (!b) return 'Please pick a booking.'
        v.bookingId = b.booking.id
      },
      clear: (v) => { v.bookingId = undefined; v.amount = undefined },
    },
    {
      key: 'amount', label: 'Amount',
      done: (v) => v.amount !== undefined,
      ask(v, ctx) {
        const b = ctx.idx.bookingInfo.get(v.bookingId!)!
        return {
          text: `${b.vendor?.name} · ${bookingLabel(b)}\nTotal ${inr(b.booking.total_amount)}, paid ${inr(b.paid)}, due ${inr(b.balance)}.\nHow much received?`,
          chips: amountChips(b.balance), input: 'number', placeholder: 'Amount, e.g. 10000 or 10k',
        }
      },
      answer(input, v, ctx) {
        const a = parseAmount(input)
        const b = ctx.idx.bookingInfo.get(v.bookingId!)!
        if (a === null || a <= 0) return 'Type an amount like 10000 or 10k.'
        if (a > b.balance) return `That is more than the balance due (${inr(b.balance)}).`
        v.amount = a
      },
      clear: (v) => { v.amount = undefined },
    },
    modeStep<PayV>(),
    accountStep<PayV>(),
    payDateStep<PayV>(),
    referenceStep<PayV>(),
  ],
  summary(v, ctx) {
    const b = ctx.idx.bookingInfo.get(v.bookingId!)!
    const rows: [string, string][] = [
      ['From', vendorLabel(b.vendor!)],
      ['Booking', bookingLabel(b)],
      ['Amount', inr(v.amount!)],
      ['Mode', MODE_LABEL[v.mode!]],
      ['Received in', ctx.accounts.find((a) => a.id === v.accountId)?.name ?? '—'],
      ['Date', fmtDate(v.payDate!)],
    ]
    if (v.reference) rows.push(['Reference', v.reference])
    rows.push(['Balance after', inr(b.balance - v.amount!)])
    return { title: 'Payment received', rows }
  },
  async commit(v, ctx) {
    const b = ctx.idx.bookingInfo.get(v.bookingId!)!
    const p = await ctx.repo.createPayment({
      exhibition_id: b.booking.exhibition_id, booking_id: b.booking.id, vendor_id: b.booking.vendor_id,
      amount: v.amount!, payment_date: v.payDate!, mode: v.mode!, account_id: v.accountId!, reference: v.reference ?? null, notes: null,
    })
    const balance = round2(b.balance - p.amount)
    await ctx.refresh()
    const share = receiptShareText({ exhibition: ctx.exhibition!, payment: p, vendor: b.vendor!, stalls: b.stalls, balance })
    return {
      text: `✅ Receipt #${p.receipt_no} saved.${balance <= 0 ? ' 🎉 Fully paid!' : ''}`,
      card: {
        title: `Receipt #${p.receipt_no}`, tone: 'success',
        rows: [['From', vendorLabel(b.vendor!)], ['Amount', inr(p.amount)], ['Mode', MODE_LABEL[p.mode]], ['Balance', inr(balance)]],
      },
      chips: [
        { label: '📤 Send receipt on WhatsApp', href: waLink(b.vendor!.phone, share), tone: 'primary' },
        { label: 'Another payment', value: 'pay' },
        { label: 'Menu', value: '__menu' },
      ],
    }
  },
}

// ───────────── New vendor ─────────────

interface VendorV { name?: string; phone?: string | null; business?: string | null; city?: string | null; category?: string | null }

const CATEGORIES = ['Clothing', 'Jewellery', 'Handicrafts', 'Home decor', 'Food', 'Kitchen', 'Toys', 'Cosmetics', 'Furniture']

export const vendorFlow: Flow<VendorV> = {
  id: 'vendor',
  title: 'New vendor',
  init: (_ctx, prefill) => ({ name: prefill.trim() || undefined }),
  steps: [
    {
      key: 'name', label: 'Name', done: (v) => !!v.name,
      ask: () => ({ text: 'Vendor’s full name?' }),
      answer(input, v) { if (input.length < 2) return 'Please type the name.'; v.name = input },
      clear: (v) => { v.name = undefined },
    },
    {
      key: 'phone', label: 'Mobile', done: (v) => v.phone !== undefined,
      ask: () => ({ text: 'Mobile number?', input: 'tel', chips: [{ label: 'Skip', value: '__skip' }] }),
      answer(input, v, ctx) {
        if (input === '__skip' || isNo(input)) { v.phone = null; return }
        const digits = input.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
        if (digits.length !== 10) return 'Please enter a 10-digit mobile number, or Skip.'
        const dup = ctx.vendors.find((x) => x.phone?.replace(/\D/g, '').endsWith(digits))
        if (dup) return `${digits} is already saved for ${vendorLabel(dup)}.`
        v.phone = digits
      },
      clear: (v) => { v.phone = undefined },
    },
    {
      key: 'business', label: 'Business name', done: (v) => v.business !== undefined,
      ask: () => ({ text: 'Business / shop name?', chips: [{ label: 'Same as name', value: '__same' }, { label: 'Skip', value: '__skip' }] }),
      answer(input, v) { v.business = input === '__skip' ? null : input === '__same' ? v.name! : input },
      clear: (v) => { v.business = undefined },
    },
    {
      key: 'category', label: 'Category', done: (v) => v.category !== undefined,
      ask: () => ({ text: 'What do they sell?', chips: [...CATEGORIES.map((c) => ({ label: c })), { label: 'Skip', value: '__skip' }] }),
      answer(input, v) { v.category = input === '__skip' ? null : input },
      clear: (v) => { v.category = undefined },
    },
    {
      key: 'city', label: 'City', done: (v) => v.city !== undefined,
      ask: (_v, ctx) => ({ text: 'City?', chips: [...(ctx.exhibition?.city ? [{ label: ctx.exhibition.city }] : []), { label: 'Skip', value: '__skip' }] }),
      answer(input, v) { v.city = input === '__skip' ? null : input },
      clear: (v) => { v.city = undefined },
    },
  ],
  summary: (v) => ({
    title: 'New vendor',
    rows: [['Name', v.name!], ['Mobile', v.phone ?? '—'], ['Business', v.business ?? '—'], ['Category', v.category ?? '—'], ['City', v.city ?? '—']],
  }),
  async commit(v, ctx) {
    await ctx.repo.insert('vendors', [{
      name: v.name!, phone: v.phone ?? null, business_name: v.business ?? null, category: v.category ?? null,
      city: v.city ?? null, gstin: null, notes: null,
    }])
    await ctx.refresh()
    return {
      text: `✅ ${v.name} added.`,
      chips: [{ label: `Book stall for ${v.name}`, value: `book ${v.name}`, tone: 'primary' }, { label: 'Menu', value: '__menu' }],
    }
  },
}

// ───────────── Router: understands free text when no flow is running ─────────────

export function menu(ctx: Ctx): Prompt {
  const free = ctx.tiles.reduce((a, t) => a + t.free, 0)
  return {
    text: ctx.exhibition
      ? `What would you like to do? (${ctx.exhibition.name} · ${free} stalls free)`
      : 'No exhibition yet. Create one in Masters first.',
    chips: [
      { label: '🏷️ Book stall', value: 'book', tone: 'primary' },
      { label: '💰 Payment', value: 'pay', tone: 'primary' },
      { label: '➕ New vendor', value: 'vendor' },
      { label: '📋 Pending dues', value: 'pending' },
      { label: '🟩 Free stalls', value: 'free' },
      { label: '❓ Help', value: 'help' },
    ],
  }
}

const HELP = `You can tap the buttons or type short commands:
• book ramesh A-7 A-8
• pay ramesh 10000 upi
• pay A-7 5000 cash yesterday
• status A-7
• balance ramesh
• free B  (free stalls in tile B)
• pending  (who still owes money)
• new vendor
Type cancel any time to stop.`

export const router: Router = (text, ctx) => {
  const s = text.trim()
  const lower = s.toLowerCase()
  const rest = (re: RegExp) => s.replace(re, '').trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const as = (f: Flow<any>) => f as Flow<unknown>

  if (/^(book|booking|new booking|book stall)\b/i.test(s)) return { start: as(bookFlow), prefill: rest(/^(new booking|book stall|booking|book)\b/i) }
  if (/^(pay|payment|paid|received|receipt|collect)\b/i.test(s)) return { start: as(payFlow), prefill: rest(/^(payment|pay|paid|received|receipt|collect)\b/i) }
  if (/^((new|add)\s+vendor|vendor)\b/i.test(s)) return { start: as(vendorFlow), prefill: rest(/^((new|add)\s+vendor|vendor)\b/i) }
  if (/^(help|\?|menu|hi|hello|namaste)$/i.test(s)) return { reply: lower === 'help' || s === '?' ? { text: HELP, chips: menu(ctx).chips } : menu(ctx) }
  if (/^(pending|dues?|outstanding|balance|baki)$/i.test(s)) return { reply: pendingReply(ctx) }
  if (/^(free|available|vacant)\b/i.test(s)) return { reply: freeReply(ctx, rest(/^(free|available|vacant)\b/i)) }
  if (/^(summary|dashboard|tiles?|report)$/i.test(s)) return { reply: summaryReply(ctx) }

  const q = rest(/^(status|stall|balance|due|vendor|check|show)\b/i)
  const { found } = findStalls(q, ctx.rows.stalls)
  if (found.length) return { reply: stallReply(ctx, found[0]) }
  const vendors = q ? matchVendors(q, ctx.vendors) : []
  if (vendors.length === 1) return { reply: vendorReply(ctx, vendors[0]) }
  if (vendors.length > 1)
    return { reply: { text: `Found ${vendors.length} vendors:`, chips: vendors.slice(0, 8).map((v) => ({ label: vendorLabel(v), value: `balance ${v.phone ?? v.name}` })) } }
  return { reply: { text: `Sorry, I didn’t get “${s}”.\n\n${HELP}`, chips: menu(ctx).chips } }
}

function pendingReply(ctx: Ctx): Prompt & { card?: Card } {
  const list = outstandingByVendor(ctx.idx)
  if (!list.length) return { text: '🎉 No pending dues.', chips: menu(ctx).chips }
  const total = list.reduce((a, o) => a + o.balance, 0)
  return {
    text: `${list.length} vendors owe ${inr(total)} in total.`,
    card: { title: 'Pending dues', rows: list.slice(0, 15).map((o) => [`${o.vendor.name} · ${o.bookings.flatMap((b) => b.stalls).map((x) => x.number).join(', ')}`, inr(o.balance)]) },
    chips: [...list.slice(0, 5).map((o) => ({ label: `Collect from ${o.vendor.name}`, value: `pay ${o.vendor.phone ?? o.vendor.name}` })), { label: 'Menu', value: '__menu' }],
  }
}

function freeReply(ctx: Ctx, tileQuery: string): Prompt & { card?: Card } {
  const tile = tileQuery.replace(/^(in\s+)?(tile\s+)?/i, '').trim()
  const tiles = ctx.tiles.filter((t) => !tile || t.tile.toLowerCase() === tile.toLowerCase())
  if (!tiles.length) return { text: `No tile called “${tile}”.`, chips: ctx.tiles.map((t) => ({ label: `Free in ${t.tile}`, value: `free ${t.tile}` })) }
  if (tile) {
    const free = freeStalls(ctx, tiles[0].tile)
    return {
      text: free.length ? `${free.length} free in tile ${tiles[0].tile}. Tap one to book:` : `Tile ${tiles[0].tile} is full.`,
      chips: free.map((s) => ({ label: s.number, value: `book ${s.number}`, sub: [s.size, inrShort(s.price)].filter(Boolean).join(' · ') })),
    }
  }
  return {
    text: 'Free stalls by tile:',
    card: { title: 'Availability', rows: tiles.map((t) => [`Tile ${t.tile}`, `${t.free} of ${t.total} free`]) },
    chips: tiles.filter((t) => t.free).map((t) => ({ label: `Tile ${t.tile}`, value: `free ${t.tile}`, sub: `${t.free} free` })),
  }
}

function summaryReply(ctx: Ctx): Prompt & { card?: Card } {
  return {
    text: 'Tile summary:',
    card: { title: ctx.exhibition?.name ?? 'Summary', rows: ctx.tiles.map((t) => [`Tile ${t.tile}`, `${t.booked}/${t.total} booked · due ${inrShort(t.pending)}`]) },
    chips: menu(ctx).chips,
  }
}

function stallReply(ctx: Ctx, s: Stall): Prompt & { card?: Card } {
  const status = ctx.idx.statusByStall.get(s.id)!
  const info = ctx.idx.bookingByStall.get(s.id)
  const rows: [string, string][] = [['Tile', s.tile], ['Size', s.size ?? '—'], ['Price', inr(s.price)], ['Status', STATUS_LABEL[status]]]
  const chips: Chip[] = []
  if (info) {
    rows.push(['Vendor', vendorLabel(info.vendor!)], ['Booking', `#${info.booking.booking_no}`], ['Paid', inr(info.paid)], ['Due', inr(info.balance)])
    if (info.balance > 0) chips.push({ label: `Collect payment`, value: `pay ${s.number}`, tone: 'primary' })
  } else if (status === 'free') chips.push({ label: `Book ${s.number}`, value: `book ${s.number}`, tone: 'primary' })
  chips.push({ label: 'Menu', value: '__menu' })
  return { text: `Stall ${s.number}`, card: { title: `Stall ${s.number}`, rows }, chips }
}

function vendorReply(ctx: Ctx, v: Vendor): Prompt & { card?: Card } {
  const list = ctx.idx.bookingsByVendor.get(v.id) ?? []
  const rows: [string, string][] = [['Mobile', v.phone ?? '—']]
  for (const b of list) rows.push([bookingLabel(b), `paid ${inrShort(b.paid)} · due ${inrShort(b.balance)}`])
  const due = list.reduce((a, b) => a + b.balance, 0)
  rows.push(['Total due', inr(due)])
  const chips: Chip[] = []
  if (due > 0) chips.push({ label: `Collect from ${v.name}`, value: `pay ${v.phone ?? v.name}`, tone: 'primary' })
  chips.push({ label: `Book stall for ${v.name}`, value: `book ${v.phone ?? v.name}` }, { label: 'Ledger', to: `/vendors/${v.id}` }, { label: 'Menu', value: '__menu' })
  return { text: list.length ? vendorLabel(v) : `${vendorLabel(v)} has no booking in this exhibition.`, card: { title: v.name, rows }, chips }
}
