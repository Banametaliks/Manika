import { beforeEach, describe, expect, it } from 'vitest'
import { localRepo } from '../data/local'
import type { Repo } from '../data/repo'
import type { Store } from '../data/store'
import { buildIndex, tileSummaries } from '../lib/compute'
import { ChatController, type Msg } from './engine'
import { menu, router } from './flows'

/** A Store backed by the in-memory demo repo, refreshed like the real one. */
async function makeStore(repo: Repo): Promise<Store> {
  const s = { repo } as Store
  s.refresh = async () => {
    const [exhibitions, vendors, accounts] = await Promise.all([repo.listExhibitions(), repo.listVendors(), repo.listAccounts()])
    const exhibition = exhibitions[0]
    const rows = await repo.loadExhibition(exhibition.id)
    const idx = buildIndex({ ...rows, vendors })
    Object.assign(s, { exhibitions, exhibition, vendors, accounts, rows, idx, tiles: tileSummaries(rows.stalls, idx) })
  }
  await s.refresh()
  return s
}

let store: Store
let chat: ChatController
const last = (): Msg => chat.messages[chat.messages.length - 1]
const chip = (label: string) => {
  const c = last().chips?.find((x) => x.label.includes(label))
  if (!c) throw new Error(`No chip "${label}" in: ${last().text}\n${last().chips?.map((x) => x.label).join(' | ')}`)
  return chat.send(c.value ?? c.label, c.label)
}

beforeEach(async () => {
  store = await makeStore(localRepo())
  chat = new ChatController(router, menu)
  chat.setContext(() => store)
  chat.start()
})

describe('book flow', () => {
  it('books a stall by tapping chips, with advance payment', async () => {
    await chip('Book stall')
    expect(last().text).toMatch(/Who is booking/)
    await chip('Priya')            // Priya has a booking, Kiran doesn't; any vendor works
    await chip('Tile A')
    await chip('A-3')
    expect(last().text).toMatch(/Selected A-3/)
    await chip('A-4')
    await chip('Done')
    expect(last().text).toMatch(/A-3, A-4: total ₹50,000/)
    await chip('₹1,000')
    await chip('Today')
    await chip('Half')             // advance ₹24,500
    await chip('UPI')
    await chip('HDFC')
    await chip('Skip')             // reference
    expect(last().card?.rows).toContainEqual(['Total', '₹49,000'])
    expect(last().card?.rows).toContainEqual(['Balance', '₹24,500'])
    await chip('Save')
    expect(last().text).toMatch(/Booking #8 saved/)
    const a3 = store.rows.stalls.find((s) => s.number === 'A-3')!
    expect(store.idx.statusByStall.get(a3.id)).toBe('partial')
  })

  it('understands a one-line command and only asks what is missing', async () => {
    await chat.send('book kiran A-9')
    expect(last().text).toMatch(/A-9: total ₹25,000. Any discount/)
    await chat.send('0')
    await chat.send('today')
    await chat.send('no')
    expect(last().card?.title).toMatch(/New booking/)
    await chat.send('yes')
    expect(last().text).toMatch(/saved/)
  })

  it('refuses a stall that is already booked', async () => {
    await chat.send('book kiran')
    await chat.send('A-1')
    expect(last().error).toBe(true)
    expect(last().text).toMatch(/A-1 is already booked by Ramesh Patil/)
  })

  it('adds a new vendor inside the booking', async () => {
    await chat.send('book')
    await chat.send('Meena Traders')
    await chip('Add “Meena Traders”')
    await chat.send('98765 43210')
    await chip('Same as name')
    await chip('Tile D')
    await chip('D-2')
    await chip('Done')
    await chip('No discount')
    await chip('Today')
    await chip('No advance')
    await chip('Save')
    expect(last().text).toMatch(/saved/)
    expect(store.vendors.some((v) => v.name === 'Meena Traders' && v.phone === '9876543210')).toBe(true)
  })

  it('lets you edit a field from the summary', async () => {
    await chat.send('book kiran A-9')
    await chat.send('0'); await chat.send('today'); await chat.send('0')
    await chip('Edit')
    await chip('Discount')
    await chat.send('5%')
    expect(last().card?.rows).toContainEqual(['Discount', '− ₹1,250'])
  })
})

describe('payment flow', () => {
  it('records a payment from a one-line command', async () => {
    await chat.send('pay imran 10k cash')
    // Imran has one booking, cash has one account → straight to date
    expect(last().text).toMatch(/Payment date/)
    await chip('Today')
    expect(last().card?.rows).toContainEqual(['Balance after', '₹32,000'])
    await chip('Save')
    expect(last().text).toMatch(/Receipt #\d+ saved/)
    expect(last().chips?.[0].href).toMatch(/^https:\/\/wa\.me\/919922778899\?text=/)
  })

  it('finds the vendor from a stall number and blocks overpayment', async () => {
    await chat.send('pay A-5')
    expect(last().text).toMatch(/due ₹15,000/)
    await chat.send('20000')
    expect(last().text).toMatch(/more than the balance/)
    await chip('Full')
    await chip('Bank')
    expect(last().text).toMatch(/which bank account/)
  })

  it('says when a vendor owes nothing', async () => {
    await chat.send('pay')
    await chat.send('anita')
    expect(last().text).toMatch(/no pending balance/)
  })
})

describe('questions', () => {
  it('answers stall status, balances and free stalls', async () => {
    await chat.send('status A-5')
    expect(last().card?.rows).toContainEqual(['Due', '₹15,000'])
    await chat.send('pending')
    expect(last().text).toMatch(/vendors owe/)
    await chat.send('free C')
    expect(last().text).toMatch(/5 free in tile C/)
  })

  it('cancel stops a flow without saving', async () => {
    const before = store.rows.bookings.length
    await chat.send('book kiran A-9')
    await chat.send('cancel')
    expect(last().text).toMatch(/Cancelled/)
    expect(store.rows.bookings.length).toBe(before)
  })
})
