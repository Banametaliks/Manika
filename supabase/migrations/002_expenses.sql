-- Manika Exhibition — expenses per exhibition
-- Run after 001_init.sql: Supabase → SQL Editor → paste → Run.

create table expenses (
  id            uuid primary key default gen_random_uuid(),
  voucher_no    bigint generated always as identity,
  exhibition_id uuid not null references exhibitions(id) on delete restrict,
  category      text not null,               -- Venue rent, Electricity, Advertising…
  payee         text,                        -- who was paid
  amount        numeric(12,2) not null check (amount > 0),
  expense_date  date not null default current_date,
  mode          text not null check (mode in ('cash','upi','bank','cheque')),
  account_id    uuid not null references accounts(id) on delete restrict,
  reference     text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index expenses_exhibition_idx on expenses(exhibition_id);
create index expenses_account_idx on expenses(account_id);

alter table expenses enable row level security;
create policy "signed-in full access" on expenses for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table expenses;
