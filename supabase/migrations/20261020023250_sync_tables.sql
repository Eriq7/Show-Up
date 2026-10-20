-- Cloud copy of Show Up data. The browser talks to these tables directly;
-- row level security is the only thing keeping one user out of another's rows.

-- The app's current data: one row per user, same JSON as localStorage `showup:state`.
create table public.user_state (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  state jsonb not null,
  -- When the data was last changed on the phone (client clock), not when it was uploaded.
  updated_at timestamptz not null
);

alter table public.user_state enable row level security;

create policy "read own state" on public.user_state
  for select to authenticated using (user_id = (select auth.uid()));
create policy "create own state" on public.user_state
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "replace own state" on public.user_state
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Workout history: one row per finished workout. Append only: no update or delete policy.
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Generated on the phone, so retrying the same upload never adds a second row.
  client_id text not null,
  routine_key text not null,
  started_at timestamptz,
  ended_at timestamptz not null,
  exercises jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);

alter table public.workouts enable row level security;

create policy "read own workouts" on public.workouts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "add own workouts" on public.workouts
  for insert to authenticated with check (user_id = (select auth.uid()));

-- When the phone and the cloud both changed, the older copy lands here instead of being thrown away.
-- Append only, like workouts.
create table public.state_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.state_backups enable row level security;

create policy "read own backups" on public.state_backups
  for select to authenticated using (user_id = (select auth.uid()));
create policy "add own backups" on public.state_backups
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Spell out table privileges instead of relying on the project's defaults.
revoke all on public.user_state, public.workouts, public.state_backups from anon, authenticated;
grant select, insert, update on public.user_state to authenticated;
grant select, insert on public.workouts to authenticated;
grant select, insert on public.state_backups to authenticated;
