-- ============================================================================
-- Keith · Command Center — optional cross-device sync (Supabase / Postgres)
-- Run this once in Supabase → SQL Editor. Then set these Vercel env vars:
--   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_SYNC_TOKEN
-- The service role key bypasses RLS, so the table is closed to anon clients.
-- ============================================================================

create table if not exists public.dashboard_state (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.dashboard_state is
  'Single-row-per-dashboard JSON snapshots written only by /api/state (service role).';

-- Close the table to the public API. Only the service role (server-side) may read/write.
alter table public.dashboard_state enable row level security;
revoke all on public.dashboard_state from anon, authenticated;
grant all on public.dashboard_state to service_role;

-- Keep updated_at honest even if a caller forgets to set it.
create or replace function public.dashboard_state_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_dashboard_state_touch on public.dashboard_state;
create trigger trg_dashboard_state_touch
before insert or update on public.dashboard_state
for each row execute function public.dashboard_state_touch();

-- Optional audit trail: uncomment to keep the last 50 snapshots per dashboard.
-- create table if not exists public.dashboard_state_history (
--   id         bigserial primary key,
--   state_id   text not null references public.dashboard_state(id) on delete cascade,
--   data       jsonb not null,
--   created_at timestamptz not null default now()
-- );
-- alter table public.dashboard_state_history enable row level security;
-- revoke all on public.dashboard_state_history from anon, authenticated;
-- grant all on public.dashboard_state_history to service_role;
--
-- create or replace function public.dashboard_state_snapshot()
-- returns trigger language plpgsql as $$
-- begin
--   insert into public.dashboard_state_history(state_id, data) values (new.id, new.data);
--   delete from public.dashboard_state_history
--    where state_id = new.id
--      and id not in (
--        select id from public.dashboard_state_history
--         where state_id = new.id order by created_at desc limit 50
--      );
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists trg_dashboard_state_snapshot on public.dashboard_state;
-- create trigger trg_dashboard_state_snapshot
-- after insert or update on public.dashboard_state
-- for each row execute function public.dashboard_state_snapshot();

-- Verify:
--   select id, updated_at, jsonb_array_length(data->'tasks') as tasks from public.dashboard_state;
