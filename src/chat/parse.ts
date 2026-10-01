import type { Account, PaymentMode, Stall, Vendor } from '../lib/types'

/** "25000", "25,000", "₹25k", "1.5L", "2 lakh" → number. */
export function parseAmount(input: string): number | null {
  const s = input.toLowerCase().replace(/[₹,\s]|rs\.?|inr/g, '')
  const m = s.match(/^(\d+(?:\.\d+)?)(k|thousand|l|lac|lakh|lakhs|cr|crore)?$/)
  if (!m) return null
  const mult = !m[2] ? 1 : m[2].startsWith('k') || m[2] === 'thousand' ? 1e3 : m[2].startsWith('c') ? 1e7 : 1e5
  const n = Math.round(Number(m[1]) * mult * 100) / 100
  return Number.isFinite(n) ? n : null
}

const MODE_WORDS: Record<string, PaymentMode> = {
  cash: 'cash', nagad: 'cash',
  upi: 'upi', gpay: 'upi', googlepay: 'upi', phonepe: 'upi', paytm: 'upi', bhim: 'upi',
  bank: 'bank', neft: 'bank', rtgs: 'bank', imps: 'bank', transfer: 'bank', online: 'bank',
  cheque: 'cheque', check: 'cheque', chq: 'cheque', dd: 'cheque',
}

export function parseMode(input: string): PaymentMode | null {
  const s = input.toLowerCase().replace(/[^a-z]/g, '')
  return MODE_WORDS[s] ?? null
}

/** Account kind a payment mode is deposited into. */
export const accountKindFor = (mode: PaymentMode) => (mode === 'cash' ? 'cash' : 'bank')

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Vendors whose name, business or phone contain every word typed. Exact name matches first. */
export function matchVendors(query: string, vendors: Vendor[]): Vendor[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const q = norm(query)
  const hits = vendors.filter((v) => {
    const hay = [v.name, v.business_name, v.phone].filter(Boolean).join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  const exact = hits.filter((v) => norm(v.name) === q || (v.business_name && norm(v.business_name) === q))
  return exact.length ? exact : hits
}

/** Finds stall numbers mentioned in text: "A-7", "a7", "A 7", "c-1,c-2". */
export function findStalls(text: string, stalls: Stall[]): { found: Stall[]; rest: string } {
  const byNorm = new Map(stalls.map((s) => [norm(s.number), s]))
  const found: Stall[] = []
  // Join "A 7" into "A7" so a letter followed by a number counts as one stall token.
  const tokens = text.replace(/\b([a-z]{1,3})\s+(\d{1,4})\b/gi, '$1$2').split(/[\s,;&]+|\band\b/i)
  const rest: string[] = []
  for (const t of tokens) {
    if (!t) continue
    const s = byNorm.get(norm(t))
    if (s && /\d/.test(t)) { if (!found.includes(s)) found.push(s) }
    else rest.push(t)
  }
  return { found, rest: rest.join(' ') }
}

export function matchAccount(text: string, accounts: Account[]): Account | null {
  const words = text.toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 3)
  for (const a of accounts) {
    const hay = `${a.name} ${a.bank_name ?? ''}`.toLowerCase()
    if (words.some((w) => hay.split(/\s+/).some((h) => h === w || h.startsWith(w)))) return a
  }
  return null
}

export const isYes = (s: string) => /^(y|yes|ok|okay|confirm|save|haan|ha|done|sure|go)$/i.test(s.trim())
export const isNo = (s: string) => /^(n|no|none|nil|skip|nahi|na|0)$/i.test(s.trim())
export const isCancel = (s: string) => /^(cancel|stop|exit|quit|abort|reset)$/i.test(s.trim())
