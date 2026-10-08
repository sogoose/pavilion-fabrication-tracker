create or replace function public.limit_pavilion_module_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.pavilion_module_photos
    where project_id = new.project_id
      and rhino_guid = new.rhino_guid
  ) >= 5 then
    raise exception 'Maximum 5 photos per module';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limit_pavilion_module_photos on public.pavilion_module_photos;
create trigger trg_limit_pavilion_module_photos
before insert on public.pavilion_module_photos
for each row execute function public.limit_pavilion_module_photos();
