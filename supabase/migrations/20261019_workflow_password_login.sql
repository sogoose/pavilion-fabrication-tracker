-- Password-based Workflow editor; separate from the open team Tracker.
-- Deliberately stores no raw password. Password hash is populated privately in Supabase.
create table if not exists public.pavilion_workflow_password_config (
  project_id text primary key,
  password_hash text not null,
  signing_key text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.pavilion_workflow_password_attempts (
  ip_hash text primary key,
  failed_attempts integer not null default 0,
  last_failed_at timestamptz,
  locked_until timestamptz
);
alter table public.pavilion_workflow_password_config enable row level security;
alter table public.pavilion_workflow_password_attempts enable row level security;
revoke all on table public.pavilion_workflow_password_config from public, anon, authenticated;
revoke all on table public.pavilion_workflow_password_attempts from public, anon, authenticated;

create or replace function public.pavilion_workflow_verify_password(
  p_password text, p_ip_hash text
) returns boolean language plpgsql security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_failures integer;
  v_last timestamptz;
  v_lock timestamptz;
  v_next integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_password is null or length(p_password) > 128 or
     p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  insert into public.pavilion_workflow_password_attempts (ip_hash)
  values (p_ip_hash) on conflict (ip_hash) do nothing;

  select failed_attempts, last_failed_at, locked_until
    into v_failures, v_last, v_lock
  from public.pavilion_workflow_password_attempts
  where ip_hash = p_ip_hash for update;

  if v_lock is not null and v_lock > v_now then return false; end if;

  select password_hash into v_hash
  from public.pavilion_workflow_password_config
  where project_id = 'pavilion-2026';

  if v_hash is null then return false; end if;
  if extensions.crypt(p_password, v_hash) = v_hash then
    update public.pavilion_workflow_password_attempts
    set failed_attempts = 0, last_failed_at = null, locked_until = null
    where ip_hash = p_ip_hash;
    return true;
  end if;

  v_next := case when v_last is null or v_last < v_now - interval '15 minutes'
    then 1 else v_failures + 1 end;
  update public.pavilion_workflow_password_attempts
  set failed_attempts = v_next,
      last_failed_at = v_now,
      locked_until = case when v_next >= 5 then v_now + interval '15 minutes' else null end
  where ip_hash = p_ip_hash;
  return false;
end;
$$;
revoke all on function public.pavilion_workflow_verify_password(text,text) from public, anon, authenticated;
grant execute on function public.pavilion_workflow_verify_password(text,text) to service_role;

-- Existing pavilion_parts, pavilion_history, pavilion_settings and module photos untouched.
