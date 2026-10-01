const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

export const inr = (n: number) => `₹${inrFmt.format(Math.round(n * 100) / 100)}`

/** Compact rupees for tiles: ₹1.2L, ₹45K. */
export function inrShort(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e7) return `₹${trim(n / 1e7)}Cr`
  if (a >= 1e5) return `₹${trim(n / 1e5)}L`
  if (a >= 1e3) return `₹${trim(n / 1e3)}K`
  return inr(n)
}
const trim = (n: number) => String(Math.round(n * 10) / 10)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** yyyy-mm-dd → "16 Oct 2026" (year dropped when it is the current year). */
export function fmtDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-').map(Number)
  const showYear = withYear || y !== new Date().getFullYear()
  return `${d} ${MONTHS[m - 1]}${showYear ? ` ${y}` : ''}`
}

export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const today = () => isoDate(new Date())

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDate(new Date(y, m - 1, d + days))
}

/** All dates from start to end inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end && out.length < 60; d = addDays(d, 1)) out.push(d)
  return out
}

/** Parses typed dates: today, yesterday, 16/10, 16-10-2026, 16 oct, 2026-10-16. */
export function parseDate(input: string, ref = today()): string | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  if (s === 'today' || s === 'aaj') return ref
  if (s === 'yesterday' || s === 'kal') return addDays(ref, -1)
  if (s === 'tomorrow') return addDays(ref, 1)
  const refYear = Number(ref.slice(0, 4))
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/)
  if (m) return valid(year(m[3], refYear), +m[2], +m[1])
  m = s.match(/^(\d{1,2})\s*([a-z]{3})[a-z]*\.?(?:\s+(\d{2,4}))?$/)
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase() === m![2])
    if (mi >= 0) return valid(year(m[3], refYear), mi + 1, +m[1])
  }
  return null
}
function year(y: string | undefined, fallback: number) {
  if (!y) return fallback
  return y.length === 2 ? 2000 + Number(y) : Number(y)
}
function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return isoDate(dt)
}

/** "3x3" → 9, "3 x 6" → 18, "10*10" → 100. */
export function areaFromSize(size: string | null | undefined): number | null {
  if (!size) return null
  const m = size.match(/^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i)
  return m ? Math.round(Number(m[1]) * Number(m[2]) * 100) / 100 : null
}

/** Natural sort so A-2 comes before A-10. */
export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export const MODE_LABEL = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', cheque: 'Cheque' } as const
