-- ═══════════════════════════════════════════════════════════════════
-- Manika Exhibition — To-do list (tasks)
-- Supabase → SQL Editor → New query → paste → Run. Safe to run again.
-- (Already included in setup.sql; run this only if setup.sql ran earlier.)
-- ═══════════════════════════════════════════════════════════════════

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
