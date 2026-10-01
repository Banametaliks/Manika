import { describe, expect, it } from 'vitest'
import { areaFromSize, inrShort, parseDate } from './format'
import { findStalls, matchVendors, parseAmount, parseMode } from '../chat/parse'
import type { Stall, Vendor } from './types'

describe('parsers', () => {
  it('reads amounts the way people type them', () => {
    expect(parseAmount('25000')).toBe(25000)
    expect(parseAmount('25,000')).toBe(25000)
    expect(parseAmount('₹ 10k')).toBe(10000)
    expect(parseAmount('1.5L')).toBe(150000)
    expect(parseAmount('2 lakh')).toBe(200000)
    expect(parseAmount('abc')).toBeNull()
  })
  it('reads dates', () => {
    expect(parseDate('today', '2026-10-01')).toBe('2026-10-01')
    expect(parseDate('yesterday', '2026-10-01')).toBe('2026-09-30')
    expect(parseDate('16/10', '2026-10-01')).toBe('2026-10-16')
    expect(parseDate('16 oct', '2026-10-01')).toBe('2026-10-16')
    expect(parseDate('5-11-26', '2026-10-01')).toBe('2026-11-05')
    expect(parseDate('31/02', '2026-10-01')).toBeNull()
  })
  it('reads payment modes', () => {
    expect(parseMode('GPay')).toBe('upi')
    expect(parseMode('neft')).toBe('bank')
    expect(parseMode('chq')).toBe('cheque')
    expect(parseMode('ramesh')).toBeNull()
  })
  it('computes area and short rupees', () => {
    expect(areaFromSize('3x6')).toBe(18)
    expect(areaFromSize('3 × 3')).toBe(9)
    expect(inrShort(125000)).toBe('₹1.3L')
    expect(inrShort(45000)).toBe('₹45K')
  })
  it('finds stalls in free text', () => {
    const stalls = ['A-1', 'A-7', 'B-10'].map((number) => ({ id: number, number }) as Stall)
    expect(findStalls('ramesh a7 and B 10', stalls).found.map((s) => s.number)).toEqual(['A-7', 'B-10'])
    expect(findStalls('ramesh a7', stalls).rest).toBe('ramesh')
  })
  it('matches vendors by name, shop or phone', () => {
    const v = [
      { id: '1', name: 'Ramesh Patil', business_name: 'Ramesh Textiles', phone: '9822012345' },
      { id: '2', name: 'Ramesh Shah', business_name: null, phone: null },
    ] as Vendor[]
    expect(matchVendors('ramesh', v)).toHaveLength(2)
    expect(matchVendors('ramesh textiles', v).map((x) => x.id)).toEqual(['1'])
    expect(matchVendors('98220', v).map((x) => x.id)).toEqual(['1'])
  })
})
