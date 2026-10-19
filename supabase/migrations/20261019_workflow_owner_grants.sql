-- Defense in depth: enforce owner-only writes at SQL GRANT level as well as RLS.
-- This changes only Workflow-owned tables. Tracker pavilion_parts remains editable by the team.
revoke all privileges on table public.pavilion_workflow_content from public, anon, authenticated;
grant select on table public.pavilion_workflow_content to anon, authenticated;
grant insert, update on table public.pavilion_workflow_content to authenticated;

-- Only authenticated sessions may read their own membership record.
-- No client session may insert/update/delete editor membership.
revoke all privileges on table public.pavilion_workflow_editors from public, anon, authenticated;
grant select on table public.pavilion_workflow_editors to authenticated;
