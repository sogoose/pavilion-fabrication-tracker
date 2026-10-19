-- Backup for records retired because their Rhino GUID is no longer found
-- in the authoritative GitHub model. Kept private for reversible cleanup.
create table if not exists public.pavilion_retired_parts_backup (
  project_id text not null,
  rhino_guid text not null,
  source_model_sha256 text not null,
  retired_reason text not null default 'missing_from_current_model',
  retired_at timestamptz not null default now(),
  original_record jsonb not null,
  primary key (project_id, rhino_guid)
);
alter table public.pavilion_retired_parts_backup enable row level security;
revoke all on public.pavilion_retired_parts_backup from public, anon, authenticated;
comment on table public.pavilion_retired_parts_backup is
  'Private recovery snapshot of removed historical Tracker rows, not visible in active app.';
