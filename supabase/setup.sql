-- ═══════════════════════════════════════════════════════════════════
-- Manika Exhibition — database setup
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once: it only creates what is missing.
-- (Uses plain quotes for function bodies so copying it cannot break them.)
-- ═══════════════════════════════════════════════════════════════════

-- ───────────── Masters ─────────────

create table if not exists exhibitions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  venue       text,
  city        text,
  start_date  date not null,
  end_date    date not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

-- Vendors are shared across all exhibitions.
create table if not exists vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  business_name text,
  phone         text,
  gstin         text,
  city          text,
  category      text,
  notes         text,
  created_at    timestamptz not null default now()
);

-- Stalls belong to one exhibition (each venue has its own layout).
create table if not exists stalls (
  id            uuid primary key default gen_random_uuid(),
  exhibition_id uuid not null references exhibitions(id) on delete cascade,
  number        text not null,
  tile          text not null,
  size          text,
  area          numeric(10,2),
  stall_type    text,
  price         numeric(12,2) not null default 0,
  blocked       boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (exhibition_id, number)
);
create index if not exists stalls_exhibition_idx on stalls(exhibition_id);

-- Bank and cash accounts.
create table if not exists accounts (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('bank','cash')),
  name            text not null,
  bank_name       text,
  account_no      text,
  ifsc            text,
  upi_id          text,
  opening_balance numeric(12,2) not null default 0,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ───────────── Transactions ─────────────

create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  booking_no    bigint generated always as identity,
  exhibition_id uuid not null references exhibitions(id) on delete restrict,
  vendor_id     uuid not null references vendors(id) on delete restrict,
  booking_date  date not null default current_date,
  gross_amount  numeric(12,2) not null,
  discount      numeric(12,2) not null default 0,
  total_amount  numeric(12,2) not null,
  status        text not null default 'active' check (status in ('active','cancelled')),
  notes         text,
  created_at    timestamptz not null default now(),
  check (discount >= 0 and total_amount = gross_amount - discount)
);
create index if not exists bookings_exhibition_idx on bookings(exhibition_id);
create index if not exists bookings_vendor_idx on bookings(vendor_id);

create table if not exists booking_stalls (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id) on delete cascade,
  exhibition_id uuid not null references exhibitions(id) on delete cascade,
  stall_id      uuid not null references stalls(id) on delete restrict,
  price         numeric(12,2) not null,
  active        boolean not null default true
);
-- A stall can be in only one active booking: this stops double booking.
create unique index if not exists booking_stalls_one_active on booking_stalls(stall_id) where active;
create index if not exists booking_stalls_exhibition_idx on booking_stalls(exhibition_id);

create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  receipt_no    bigint generated always as identity,
  exhibition_id uuid not null references exhibitions(id) on delete restrict,
  booking_id    uuid not null references bookings(id) on delete restrict,
  vendor_id     uuid not null references vendors(id) on delete restrict,
  amount        numeric(12,2) not null check (amount > 0),
  payment_date  date not null default current_date,
  mode          text not null check (mode in ('cash','upi','bank','cheque')),
  account_id    uuid not null references accounts(id) on delete restrict,
  reference     text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists payments_exhibition_idx on payments(exhibition_id);
create index if not exists payments_vendor_idx on payments(vendor_id);
create index if not exists payments_account_idx on payments(account_id);

create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  voucher_no    bigint generated always as identity,
  exhibition_id uuid not null references exhibitions(id) on delete restrict,
  category      text not null,
  payee         text,
  amount        numeric(12,2) not null check (amount > 0),
  expense_date  date not null default current_date,
  mode          text not null check (mode in ('cash','upi','bank','cheque')),
  account_id    uuid not null references accounts(id) on delete restrict,
  reference     text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists expenses_exhibition_idx on expenses(exhibition_id);
create index if not exists expenses_account_idx on expenses(account_id);

-- ───────────── Functions ─────────────

-- Creates a booking and its stall rows in one transaction.
-- Fails if any stall is blocked, belongs to another exhibition or is already booked.
create or replace function create_booking(
  p_exhibition_id uuid,
  p_vendor_id     uuid,
  p_booking_date  date,
  p_discount      numeric,
  p_notes         text,
  p_stall_ids     uuid[]
) returns bookings
language plpgsql
as '
declare
  v_gross   numeric(12,2);
  v_count   int;
  v_booking bookings;
begin
  if coalesce(array_length(p_stall_ids, 1), 0) = 0 then
    raise exception ''Select at least one stall'';
  end if;

  select count(*), coalesce(sum(price), 0) into v_count, v_gross
  from stalls
  where id = any(p_stall_ids) and exhibition_id = p_exhibition_id and not blocked;

  if v_count <> array_length(p_stall_ids, 1) then
    raise exception ''One or more stalls are blocked or not part of this exhibition'';
  end if;
  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_gross then
    raise exception ''Discount must be between 0 and %'', v_gross;
  end if;

  insert into bookings (exhibition_id, vendor_id, booking_date, gross_amount, discount, total_amount, notes)
  values (p_exhibition_id, p_vendor_id, coalesce(p_booking_date, current_date), v_gross,
          coalesce(p_discount, 0), v_gross - coalesce(p_discount, 0), p_notes)
  returning * into v_booking;

  begin
    insert into booking_stalls (booking_id, exhibition_id, stall_id, price)
    select v_booking.id, p_exhibition_id, s.id, s.price
    from stalls s where s.id = any(p_stall_ids);
  exception when unique_violation then
    raise exception ''One or more stalls were just booked by someone else'';
  end;

  return v_booking;
end;
';

-- Cancels a booking and frees its stalls. Payments stay on record.
create or replace function cancel_booking(p_booking_id uuid) returns void
language sql
as '
  update bookings set status = ''cancelled'' where id = p_booking_id;
  update booking_stalls set active = false where booking_id = p_booking_id;
';

-- ───────────── Access ─────────────
-- Every signed-in staff member can see and edit everything.
-- People who are not signed in can see nothing.

alter table exhibitions enable row level security;
drop policy if exists "signed-in full access" on exhibitions;
create policy "signed-in full access" on exhibitions for all to authenticated using (true) with check (true);
grant select, insert, update, delete on exhibitions to authenticated;
revoke all on exhibitions from anon;

alter table vendors enable row level security;
drop policy if exists "signed-in full access" on vendors;
create policy "signed-in full access" on vendors for all to authenticated using (true) with check (true);
grant select, insert, update, delete on vendors to authenticated;
revoke all on vendors from anon;

alter table stalls enable row level security;
drop policy if exists "signed-in full access" on stalls;
create policy "signed-in full access" on stalls for all to authenticated using (true) with check (true);
grant select, insert, update, delete on stalls to authenticated;
revoke all on stalls from anon;

alter table accounts enable row level security;
drop policy if exists "signed-in full access" on accounts;
create policy "signed-in full access" on accounts for all to authenticated using (true) with check (true);
grant select, insert, update, delete on accounts to authenticated;
revoke all on accounts from anon;

alter table bookings enable row level security;
drop policy if exists "signed-in full access" on bookings;
create policy "signed-in full access" on bookings for all to authenticated using (true) with check (true);
grant select, insert, update, delete on bookings to authenticated;
revoke all on bookings from anon;

alter table booking_stalls enable row level security;
drop policy if exists "signed-in full access" on booking_stalls;
create policy "signed-in full access" on booking_stalls for all to authenticated using (true) with check (true);
grant select, insert, update, delete on booking_stalls to authenticated;
revoke all on booking_stalls from anon;

alter table payments enable row level security;
drop policy if exists "signed-in full access" on payments;
create policy "signed-in full access" on payments for all to authenticated using (true) with check (true);
grant select, insert, update, delete on payments to authenticated;
revoke all on payments from anon;

alter table expenses enable row level security;
drop policy if exists "signed-in full access" on expenses;
create policy "signed-in full access" on expenses for all to authenticated using (true) with check (true);
grant select, insert, update, delete on expenses to authenticated;
revoke all on expenses from anon;

revoke execute on function create_booking(uuid, uuid, date, numeric, text, uuid[]) from public, anon;
revoke execute on function cancel_booking(uuid) from public, anon;
grant execute on function create_booking(uuid, uuid, date, numeric, text, uuid[]) to authenticated;
grant execute on function cancel_booking(uuid) to authenticated;

-- ───────────── Live updates on every phone ─────────────

do '
begin
  if not exists (select 1 from pg_publication where pubname = ''supabase_realtime'') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = ''supabase_realtime'' and schemaname = ''public'' and tablename = ''exhibitions'') then
    alter publication supabase_realtime add table public.exhibitions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = ''supabase_realtime'' and schemaname = ''public'' and tablename = ''vendors'') then
    alter publication supabase_realtime add table public.vendors;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = ''supabase_realtime'' and schemaname = ''public'' and tablename = ''stalls'') then
    alter publication supabase_realtime add table public.stalls;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = ''supabase_realtime'' and schemaname = ''public'' and tablename = ''accounts'') then
    alter publication supabase_realtime add table public.accounts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = ''supabase_realtime'' and schemaname = ''public'' and tablename = ''bookings'') then
    alter publication supabase_realtime add table public.bookings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = ''supabase_realtime'' and schemaname = ''public'' and tablename = ''booking_stalls'') then
    alter publication supabase_realtime add table public.booking_stalls;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = ''supabase_realtime'' and schemaname = ''public'' and tablename = ''payments'') then
    alter publication supabase_realtime add table public.payments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = ''supabase_realtime'' and schemaname = ''public'' and tablename = ''expenses'') then
    alter publication supabase_realtime add table public.expenses;
  end if;
end
';

-- ───────────── To-do list ─────────────

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  exhibition_id uuid references exhibitions(id) on delete cascade,  -- empty = general task
  title         text not null check (length(trim(title)) > 0),
  notes         text,
  assigned_to   text,
  due_date      date,
  done          boolean not null default false,
  done_at       timestamptz,
  done_by       text,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists tasks_exhibition_idx on tasks(exhibition_id);

alter table tasks enable row level security;
drop policy if exists "signed-in full access" on tasks;
create policy "signed-in full access" on tasks for all to authenticated using (true) with check (true);
grant select, insert, update, delete on tasks to authenticated;
revoke all on tasks from anon;

do '
begin
  if not exists (select 1 from pg_publication_tables where pubname = ''supabase_realtime'' and schemaname = ''public'' and tablename = ''tasks'') then
    alter publication supabase_realtime add table public.tasks;
  end if;
end
';
