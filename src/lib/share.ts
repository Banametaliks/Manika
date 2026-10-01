import type { Booking, Exhibition, Payment, Stall, Vendor } from './types'
import { MODE_LABEL, fmtDate, inr } from './format'

/** WhatsApp link: opens the vendor's chat when we have their number, else lets the user pick. */
export function waLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  const to = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`
}

const showDates = (e: Exhibition) => `${fmtDate(e.start_date)} – ${fmtDate(e.end_date, true)}`

export function bookingShareText(a: { exhibition: Exhibition; booking: Booking; vendor: Vendor; stalls: Stall[]; paid: number }) {
  const { exhibition: e, booking: b } = a
  return [
    `*${e.name}*`,
    `${[e.venue, e.city].filter(Boolean).join(', ')} · ${showDates(e)}`,
    ``,
    `Booking confirmed ✅`,
    `Booking no: #${b.booking_no}`,
    `Vendor: ${a.vendor.business_name || a.vendor.name}`,
    `Stall: ${a.stalls.map((s) => `${s.number}${s.size ? ` (${s.size})` : ''}`).join(', ')}`,
    `Amount: ${inr(b.total_amount)}`,
    `Paid: ${inr(a.paid)}`,
    `Balance: ${inr(b.total_amount - a.paid)}`,
    ``,
    `Thank you!`,
  ].join('\n')
}

export function receiptShareText(a: { exhibition: Exhibition; payment: Payment; vendor: Vendor; stalls: Stall[]; balance: number }) {
  const { exhibition: e, payment: p } = a
  return [
    `*${e.name}*`,
    `Payment receipt #${p.receipt_no}`,
    ``,
    `Received with thanks from ${a.vendor.business_name || a.vendor.name}`,
    `Amount: ${inr(p.amount)}`,
    `Mode: ${MODE_LABEL[p.mode]}${p.reference ? ` (${p.reference})` : ''}`,
    `Date: ${fmtDate(p.payment_date, true)}`,
    `Stall: ${a.stalls.map((s) => s.number).join(', ')}`,
    `Balance due: ${inr(a.balance)}`,
  ].join('\n')
}
