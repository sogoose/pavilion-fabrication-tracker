-- Workflow password login rate limiting. For server-side Edge Function only.
-- Login is protected by PBKDF2-SHA256 verification in the Edge Function;
-- this atomic function enforces 5 failed attempts per IP / 15 minutes.
create or replace function public.pavilion_workflow_rate_limit_auth(
  p_ip_hash text, p_correct boolean
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_failed integer;
  v_last timestamptz;
  v_lock timestamptz;
  v_next integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_correct is null then
    return false;
  end if;
  insert into public.pavilion_workflow_password_attempts (ip_hash)
  values (p_ip_hash) on conflict(ip_hash) do nothing;
  select failed_attempts, last_failed_at, locked_until
  into v_failed, v_last, v_lock
  from public.pavilion_workflow_password_attempts
  where ip_hash = p_ip_hash for update;
  if v_lock is not null and v_lock > v_now then return false; end if;
  if p_correct then
    update public.pavilion_workflow_password_attempts
    set failed_attempts=0, last_failed_at=null, locked_until=null
    where ip_hash=p_ip_hash;
    return true;
  end if;
  v_next := case when v_last is null or v_last < v_now - interval '15 minutes'
    then 1 else v_failed + 1 end;
  update public.pavilion_workflow_password_attempts
  set failed_attempts=v_next, last_failed_at=v_now,
      locked_until=case when v_next >= 5 then v_now + interval '15 minutes' else null end
  where ip_hash=p_ip_hash;
  return false;
end;
$$;
revoke all on function public.pavilion_workflow_rate_limit_auth(text,boolean) from public,anon,authenticated;
grant execute on function public.pavilion_workflow_rate_limit_auth(text,boolean) to service_role;
