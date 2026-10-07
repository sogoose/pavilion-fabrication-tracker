create table if not exists public.pavilion_settings (
  project_id text primary key,
  color_overrides jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.pavilion_settings enable row level security;

drop policy if exists "pavilion_settings_select" on public.pavilion_settings;
create policy "pavilion_settings_select"
on public.pavilion_settings for select
to anon, authenticated
using (true);

drop policy if exists "pavilion_settings_insert" on public.pavilion_settings;
create policy "pavilion_settings_insert"
on public.pavilion_settings for insert
to anon, authenticated
with check (true);

drop policy if exists "pavilion_settings_update" on public.pavilion_settings;
create policy "pavilion_settings_update"
on public.pavilion_settings for update
to anon, authenticated
using (true)
with check (true);

insert into public.pavilion_settings (project_id)
values ('pavilion-2026')
on conflict (project_id) do nothing;

do $$
begin
  alter publication supabase_realtime add table public.pavilion_settings;
exception
  when duplicate_object then null;
end $$;
