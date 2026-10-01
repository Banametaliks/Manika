# Manika Exhibition

Mobile-first PWA for managing exhibition stalls, vendors and payments. Bookings and payments are entered through a guided chat.

## Features (Phase 1)

- **Dashboard**: stalls, area, booked, available, collected and pending, tile by tile, plus today's cash and bank collection.
- **Tile view**: colour-coded stall grid (available, unpaid, part paid, fully paid, blocked). Tap a stall to book it, take a payment, or block it.
- **Chat entry**: book stalls (with advance), record payments, add vendors. Every step suggests options (vendors, free stalls, amounts, dates, accounts). Quick commands also work:
  - `book ramesh A-7 A-8`
  - `pay ramesh 10k upi`
  - `pay A-5 5000 cash yesterday`
  - `status A-7`, `balance ramesh`, `free B`, `pending`
- **Bookings and payments**: search, filter by due or paid, cancel a booking, delete a receipt, share on WhatsApp.
- **Masters**:
  - Exhibitions (several, sharing one vendor list)
  - Stalls (bulk add like A-1…A-20, or copy the layout from a previous exhibition)
  - Vendors
  - Bank accounts
  - Cash books
- **Vendor ledger**: the vendor's history across all exhibitions.
- **Cash book and bank book**: a running balance per account.
- **Live updates**: when one phone saves, every other phone refreshes.
- **Installable**: works as an app from the home screen (PWA).

Pricing is a fixed price per stall, with an optional discount per booking. Partial payments are supported. A stall can never be double-booked; the database enforces this.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + chat-flow tests
npm run build
```

With no Supabase keys, the app runs in **demo mode**: sample data is stored in the browser, so you can try it straight away.

## Connect Supabase (go live)

1. Create a project at https://supabase.com (the free tier is fine).
2. Open **SQL Editor**, paste `supabase/migrations/001_init.sql`, then click **Run**.
3. Go to **Authentication → Users → Add user** and create a login for each staff member.
4. Copy `.env.example` to `.env`, then fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (found under Project Settings → API).
5. `npm run build` and deploy `dist/` to Vercel or Netlify. Add the same two env vars there.
6. In the app: Masters → Exhibitions → New, then Stalls → Bulk add, then add your Bank and Cash accounts.

## Layout

```
src/
  chat/       engine.ts (conversation runner), flows.ts (book / pay / vendor / questions), parse.ts
  data/       repo.ts (interface), supabase.ts, local.ts (demo), store.tsx (React state + live refresh)
  lib/        compute.ts (stall status, balances, tile summaries), format.ts, share.ts (WhatsApp)
  pages/      Dashboard, TileView, Chat, Bookings, Masters, VendorLedger, AccountBook, Login
supabase/migrations/001_init.sql
```

## Next (Phase 2 ideas)

User roles, PDF receipts and GST invoices, expenses with P&L per exhibition, a floor-plan map, payment reminders, an offline queue, Excel export.

## Preview build

`npm run build:preview` makes `dist-preview/manika-preview.html`: the whole app in one self-contained page (demo mode, no service worker). This is the file published as the shareable preview link.
