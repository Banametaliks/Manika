import type { Chip } from './engine'

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1e3, k: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7,
}

/**
 * Turns what the speech recogniser hears into what the chat understands:
 * "pay ramesh ten thousand rupees by cash" → "pay ramesh 10000 by cash",
 * "stall A dash 7" → "stall A-7", "16th of October" → "16 October".
 */
export function normalizeSpeech(input: string): string {
  let s = input.trim()
    .replace(/(\d),(?=\d)/g, '$1')                      // 10,000 → 10000
    .replace(/\s*(?:dash|hyphen|minus)\s*/gi, '-')      // A dash 7 → A-7
    .replace(/(\d+)(?:st|nd|rd|th)\b/gi, '$1')          // 16th → 16
    .replace(/\b(\d{1,2})\s+of\s+(?=[a-z]{3})/gi, '$1 ') // 16 of October → 16 October
    .replace(/[₹]|\b(?:rupees?|rs\.?|bucks)\b/gi, ' ')
    .replace(/[.?!]+$/, '')

  // Collapse runs of number words / digits + scale words into one figure.
  const out: string[] = []
  let total = 0, current = 0, inNumber = false
  const flush = () => {
    if (inNumber) out.push(String(total + current))
    total = 0; current = 0; inNumber = false
  }
  for (const tok of s.split(/\s+/)) {
    const w = tok.toLowerCase()
    if (/^\d+(?:\.\d+)?$/.test(w) && !inNumber) { current = Number(w); inNumber = true; continue }
    if (w in UNITS) {
      // "twenty five" adds; "five five" would be two numbers, so flush first.
      if (inNumber && current % 10 !== 0 && UNITS[w] < 10 && current !== 0) flush()
      current += UNITS[w]; inNumber = true; continue
    }
    if (w in SCALES && inNumber) {
      const scale = SCALES[w]
      if (scale === 100) current = (current || 1) * 100
      else { total += (current || 1) * scale; current = 0 }
      continue
    }
    if (w === 'and' && inNumber) continue
    flush()
    out.push(tok)
  }
  flush()
  s = out.join(' ')
  // "A 7" stays as is: the stall finder already joins a letter and a number.
  return s.replace(/\s+/g, ' ').trim()
}

const clean = (s: string) =>
  s.toLowerCase().replace(/(\d),(?=\d)/g, '$1').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/**
 * When the user says or types the words on one of the offered buttons ("full",
 * "cash", "today", "done"), use that button's value. Returns null when no single
 * button clearly matches, so the text goes to the flow as typed.
 */
export function matchChip(text: string, chips: Chip[] | undefined): Chip | null {
  if (!chips?.length) return null
  const t = clean(text)
  if (!t) return null
  const usable = chips.filter((c) => !c.href && !c.to)
  const labelOf = (c: Chip) => clean(c.label)
  const firstPart = (c: Chip) => clean(c.label.split('·')[0])

  const exact = usable.filter((c) => labelOf(c) === t || firstPart(c) === t)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  if (t.length < 3) return null
  const prefix = usable.filter((c) => labelOf(c).startsWith(t) || labelOf(c).split(' ').some((w) => w === t))
  return prefix.length === 1 ? prefix[0] : null
}
