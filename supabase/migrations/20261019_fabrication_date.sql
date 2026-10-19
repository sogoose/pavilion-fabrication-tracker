-- Fabrication date is separate from firing date and belongs to every module.
alter table public.pavilion_parts
  add column if not exists fabrication_date date;
-- No rows are overwritten. Existing tracker policies and sharing are unchanged.
comment on column public.pavilion_parts.fabrication_date is
  'Date this module was fabricated (3D printed or rammed), independent of firing.';
