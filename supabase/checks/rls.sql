-- Run: supabase db query --linked -f supabase/checks/rls.sql
-- Expect the error "RLS CHECK PASSED (rolled back)". Anything else is a broken rule.
-- Checks the row level security rules as two made-up users, A and B.
-- Everything runs in one block that always ends by raising an exception,
-- so the fake users and rows are rolled back and nothing is left behind.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  n int;
  failed text := '';
  as_user text := 'select set_config(''request.jwt.claims'', json_build_object(''sub'', %L, ''role'', ''authenticated'')::text, true)';
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'rls-a@example.invalid', 'authenticated', 'authenticated'),
    (b, 'rls-b@example.invalid', 'authenticated', 'authenticated');

  -- A saves state twice (second time is the upsert the app does) and a workout.
  execute format(as_user, a);
  execute 'set local role authenticated';
  insert into public.user_state (state, updated_at) values ('{"who":"A","v":1}', now());
  insert into public.user_state (state, updated_at) values ('{"who":"A","v":2}', now())
    on conflict (user_id) do update set state = excluded.state, updated_at = excluded.updated_at;
  select (state->>'v')::int into n from public.user_state;
  if n is distinct from 2 then failed := failed || ' upsert;'; end if;

  insert into public.workouts (client_id, routine_key, ended_at, exercises) values ('c1', 'chest', now(), '[]');
  begin
    insert into public.workouts (client_id, routine_key, ended_at, exercises) values ('c1', 'chest', now(), '[]');
    failed := failed || ' duplicate client_id allowed;';
  exception when unique_violation then null;
  end;
  begin
    update public.workouts set routine_key = 'back';
    failed := failed || ' workout update allowed;';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.workouts;
    failed := failed || ' workout delete allowed;';
  exception when insufficient_privilege then null;
  end;
  insert into public.state_backups (state) values ('{"who":"A"}');

  -- B must not see or touch any of A's rows.
  execute 'reset role';
  execute format(as_user, b);
  execute 'set local role authenticated';
  select count(*) into n from public.user_state;
  if n <> 0 then failed := failed || ' B reads A state;'; end if;
  select count(*) into n from public.workouts;
  if n <> 0 then failed := failed || ' B reads A workouts;'; end if;
  select count(*) into n from public.state_backups;
  if n <> 0 then failed := failed || ' B reads A backups;'; end if;
  update public.user_state set state = '{"who":"B"}';
  get diagnostics n = row_count;
  if n <> 0 then failed := failed || ' B overwrites A state;'; end if;
  begin
    insert into public.user_state (user_id, state, updated_at) values (a, '{"who":"B"}', now());
    failed := failed || ' B writes row as A;';
  exception when insufficient_privilege or unique_violation then null;
  end;
  begin
    insert into public.workouts (user_id, client_id, routine_key, ended_at, exercises) values (a, 'b1', 'chest', now(), '[]');
    failed := failed || ' B adds workout as A;';
  exception when insufficient_privilege then null;
  end;

  -- Not logged in: no access at all.
  execute 'reset role';
  execute 'set local role anon';
  begin
    select count(*) into n from public.user_state;
    failed := failed || ' anon reads user_state;';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  if failed = '' then
    raise exception 'RLS CHECK PASSED (rolled back)';
  else
    raise exception 'RLS CHECK FAILED:%', failed;
  end if;
end $$;
