import { describe, expect, it } from 'vitest'
import { matchChip, normalizeSpeech } from './voice'
import type { Chip } from './engine'

describe('normalizeSpeech', () => {
  it.each([
    ['pay Ramesh ten thousand rupees cash', 'pay Ramesh 10000 cash'],
    ['pay Ramesh 10,000 by UPI', 'pay Ramesh 10000 by UPI'],
    ['twenty five thousand five hundred', '25500'],
    ['two lakh fifty thousand', '250000'],
    ['1.5 lakh', '150000'],
    ['10 k', '10000'],
    ['book stall A dash 7 for Kiran', 'book stall A-7 for Kiran'],
    ['pay A 5 5000 cash', 'pay A 5 5000 cash'],
    ['16th of October', '16 October'],
    ['five five', '5 5'],
    ['Book stall.', 'Book stall'],
  ])('%s → %s', (said, expected) => {
    expect(normalizeSpeech(said)).toBe(expected)
  })
})

describe('matchChip', () => {
  const chips: Chip[] = [
    { label: 'Full · ₹15,000', value: '15000' },
    { label: 'Half · ₹7,500', value: '7500' },
    { label: '💵 Cash', value: 'cash' },
    { label: 'Today · 1 Oct', value: '2026-10-01' },
    { label: 'Ramesh Patil', value: 'v:1' },
    { label: 'WhatsApp', href: 'https://wa.me/' },
  ]
  it('picks the button whose words were said', () => {
    expect(matchChip('full', chips)?.value).toBe('15000')
    expect(matchChip('Cash', chips)?.value).toBe('cash')
    expect(matchChip('today', chips)?.value).toBe('2026-10-01')
    expect(matchChip('ramesh', chips)?.value).toBe('v:1')
    expect(matchChip('₹7,500', chips)?.value).toBe('7500')
  })
  it('leaves other text alone', () => {
    expect(matchChip('12000', chips)).toBeNull()
    expect(matchChip('whatsapp', chips)).toBeNull()
    expect(matchChip('a', chips)).toBeNull()
  })
})
