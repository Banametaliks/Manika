-- Manika Exhibition — initial schema
-- Run in Supabase: Dashboard → SQL Editor → paste → Run.

create extension if not exists pgcrypto;

-- ───────────── Masters ─────────────

create table exhibitions (
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
create table vendors (
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
create table stalls (
  id            uuid primary key default gen_random_uuid(),
  exhibition_id uuid not null references exhibitions(id) on delete cascade,
  number        text not null,
  tile          text not null,
  size          text,                 -- e.g. "3x3"
  area          numeric(10,2),        -- sq. m / sq. ft, whatever the venue uses
  stall_type    text,                 -- corner, inline, premium…
  price         numeric(12,2) not null default 0,   -- fixed price
  blocked       boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (exhibition_id, number)
);
create index stalls_exhibition_idx on stalls(exhibition_id);

-- Bank and cash accounts (one table, kind tells them apart).
create table accounts (
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

create table bookings (
  id            uuid primary key default gen_random_uuid(),
  booking_no    bigint generated always as identity,
  exhibition_id uuid not null references exhibitions(id) on delete restrict,
  vendor_id     uuid not null references vendors(id) on delete restrict,
  booking_date  date not null default current_date,
  gross_amount  numeric(12,2) not null,           -- sum of stall prices
  discount      numeric(12,2) not null default 0,
  total_amount  numeric(12,2) not null,           -- gross - discount
  status        text not null default 'active' check (status in ('active','cancelled')),
  notes         text,
  created_at    timestamptz not null default now(),
  check (discount >= 0 and total_amount = gross_amount - discount)
);
create index bookings_exhibition_idx on bookings(exhibition_id);
create index bookings_vendor_idx on bookings(vendor_id);

create table booking_stalls (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id) on delete cascade,
  exhibition_id uuid not null references exhibitions(id) on delete cascade,
  stall_id      uuid not null references stalls(id) on delete restrict,
  price         numeric(12,2) not null,
  active        boolean not null default true
);
-- A stall can be in only one active booking: this is what stops double booking.
create unique index booking_stalls_one_active on booking_stalls(stall_id) where active;
create index booking_stalls_exhibition_idx on booking_stalls(exhibition_id);

create table payments (
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
create index payments_exhibition_idx on payments(exhibition_id);
create index payments_vendor_idx on payments(vendor_id);

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
as $$
declare
  v_gross   numeric(12,2);
  v_count   int;
  v_booking bookings;
begin
  if coalesce(array_length(p_stall_ids, 1), 0) = 0 then
    raise exception 'Select at least one stall';
  end if;

  select count(*), coalesce(sum(price), 0) into v_count, v_gross
  from stalls
  where id = any(p_stall_ids) and exhibition_id = p_exhibition_id and not blocked;

  if v_count <> array_length(p_stall_ids, 1) then
    raise exception 'One or more stalls are blocked or not part of this exhibition';
  end if;
  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_gross then
    raise exception 'Discount must be between 0 and %', v_gross;
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
    raise exception 'One or more stalls were just booked by someone else';
  end;

  return v_booking;
end;
$$;

-- Cancels a booking and frees its stalls. Payments stay on record.
create or replace function cancel_booking(p_booking_id uuid) returns void
language sql
as $$
  update bookings set status = 'cancelled' where id = p_booking_id;
  update booking_stalls set active = false where booking_id = p_booking_id;
$$;

-- ───────────── Security ─────────────
-- For now every signed-in user can see and edit everything.
-- Roles (admin / booking staff / accountant) will tighten these later.

alter table exhibitions    enable row level security;
alter table vendors        enable row level security;
alter table stalls         enable row level security;
alter table accounts       enable row level security;
alter table bookings       enable row level security;
alter table booking_stalls enable row level security;
alter table payments       enable row level security;

create policy "signed-in full access" on exhibitions    for all to authenticated using (true) with check (true);
create policy "signed-in full access" on vendors        for all to authenticated using (true) with check (true);
create policy "signed-in full access" on stalls         for all to authenticated using (true) with check (true);
create policy "signed-in full access" on accounts       for all to authenticated using (true) with check (true);
create policy "signed-in full access" on bookings       for all to authenticated using (true) with check (true);
create policy "signed-in full access" on booking_stalls for all to authenticated using (true) with check (true);
create policy "signed-in full access" on payments       for all to authenticated using (true) with check (true);

revoke execute on function create_booking(uuid, uuid, date, numeric, text, uuid[]) from public, anon;
revoke execute on function cancel_booking(uuid) from public, anon;
grant execute on function create_booking(uuid, uuid, date, numeric, text, uuid[]) to authenticated;
grant execute on function cancel_booking(uuid) to authenticated;

-- Live updates on every phone.
alter publication supabase_realtime add table stalls, bookings, booking_stalls, payments, vendors, accounts, exhibitions;
