-- Workflow editor permissions (run in Supabase SQL Editor once).
-- Nothing grants edit access automatically. See assets/workflow/README.md.
create table if not exists public.pavilion_workflow_editors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.pavilion_workflow_editors enable row level security;
create policy "workflow_membership_read" on public.pavilion_workflow_editors
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.pavilion_workflow_content (
  project_id text not null default 'pavilion-2026',
  section_id text not null,
  content jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (project_id, section_id),
  constraint workflow_section_id_length check (char_length(section_id) between 1 and 80),
  constraint workflow_content_is_object check (jsonb_typeof(content) = 'object'),
  constraint workflow_content_size check (pg_column_size(content) <= 16000)
);
alter table public.pavilion_workflow_content enable row level security;
create policy "workflow_public_read" on public.pavilion_workflow_content
  for select to anon,authenticated using (project_id = 'pavilion-2026');
create policy "workflow_editor_insert" on public.pavilion_workflow_content
  for insert to authenticated with check (
    project_id = 'pavilion-2026' and updated_by = auth.uid()
    and exists(select 1 from public.pavilion_workflow_editors where user_id = auth.uid())
  );
create policy "workflow_editor_update" on public.pavilion_workflow_content
  for update to authenticated
  using (project_id = 'pavilion-2026' and exists(select 1 from public.pavilion_workflow_editors where user_id = auth.uid()))
  with check (project_id = 'pavilion-2026' and updated_by = auth.uid()
    and exists(select 1 from public.pavilion_workflow_editors where user_id = auth.uid()));
-- Grant editor only after they sign in once:
-- insert into public.pavilion_workflow_editors(user_id)
-- select id from auth.users where email = 'YOUR-EMAIL@EXAMPLE.COM'
-- on conflict (user_id) do nothing;
