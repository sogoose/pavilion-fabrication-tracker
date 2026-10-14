insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pavilion-gcode-files',
  'pavilion-gcode-files',
  false,
  52428800,
  array['text/plain','application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pavilion_gcode_upload" on storage.objects;
create policy "pavilion_gcode_upload"
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'pavilion-gcode-files'
  and (storage.foldername(name))[1] = 'pavilion-2026'
);

drop policy if exists "pavilion_gcode_download" on storage.objects;
create policy "pavilion_gcode_download"
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'pavilion-gcode-files'
  and (storage.foldername(name))[1] = 'pavilion-2026'
);
