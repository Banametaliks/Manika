-- ═══════════════════════════════════════════════════════════════════
-- Manika Exhibition — DELETE ALL DATA (keeps tables and settings)
-- Use only to wipe test entries before going live. This cannot be undone.
-- Supabase → SQL Editor → paste → Run.
-- ═══════════════════════════════════════════════════════════════════

truncate table
  expenses, payments, booking_stalls, bookings, stalls, accounts, vendors, exhibitions
  restart identity;   -- booking, receipt and voucher numbers start again from 1
