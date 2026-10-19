-- Open the Workflow editing surface to all visitors, matching shared Tracker operation.
-- No change to pavilion_parts, pavilion_settings, history, or photo storage.
-- No delete permission; section IDs are limited to the built-in workflow processes.
drop policy if exists workflow_editor_insert on public.pavilion_workflow_content;
drop policy if exists workflow_editor_update on public.pavilion_workflow_content;
drop policy if exists workflow_shared_insert on public.pavilion_workflow_content;
drop policy if exists workflow_shared_update on public.pavilion_workflow_content;

create policy workflow_shared_insert on public.pavilion_workflow_content
for insert to anon, authenticated
with check (
  project_id = 'pavilion-2026'
  and updated_by is null
  and section_id in (
    '__page', 'spatial', 'structural', 'gcode', 'material',
    'printing', 'rammed', 'firing', 'assembly',
    'computational', 'construction', 'environment', 'hrc'
  )
);

create policy workflow_shared_update on public.pavilion_workflow_content
for update to anon, authenticated
using (project_id = 'pavilion-2026')
with check (
  project_id = 'pavilion-2026'
  and updated_by is null
  and section_id in (
    '__page', 'spatial', 'structural', 'gcode', 'material',
    'printing', 'rammed', 'firing', 'assembly',
    'computational', 'construction', 'environment', 'hrc'
  )
);

grant select, insert, update on table public.pavilion_workflow_content to anon, authenticated;
-- Private password config and editor registration retain zero public write access.
