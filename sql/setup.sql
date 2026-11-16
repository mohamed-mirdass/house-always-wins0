-- Run once in the target Supabase project's SQL editor.
-- Private state includes decks and pending bets. Never publish it to Realtime.
create schema if not exists royal_spin;
revoke all on schema royal_spin from public, anon, authenticated;
create table if not exists royal_spin.game (
  id integer primary key check (id = 1),
  state jsonb not null default '{}'
);
alter table royal_spin.game enable row level security;
insert into royal_spin.game(id) values (1) on conflict do nothing;

-- Only an invalidation counter is publicly readable, never private game state.
create table if not exists public.royal_spin_revision (
  id integer primary key check (id = 1),
  revision bigint not null default 0
);
alter table public.royal_spin_revision enable row level security;
revoke all on public.royal_spin_revision from anon, authenticated;
grant select on public.royal_spin_revision to anon, authenticated;
drop policy if exists revision_read on public.royal_spin_revision;
create policy revision_read on public.royal_spin_revision for select to anon, authenticated using (true);
insert into public.royal_spin_revision(id) values (1) on conflict do nothing;
do $$ begin
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='royal_spin_revision') then
   alter publication supabase_realtime add table public.royal_spin_revision;
 end if;
end $$;

-- Durable idempotency keys: a retried action never places a second wager.
create table if not exists royal_spin.requests (
  session_id uuid not null,
  request_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(session_id, request_id)
);
alter table royal_spin.requests enable row level security;
