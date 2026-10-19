-- Duration of a kiln firing cycle in hours, independent of print duration.
-- Retain all existing firing dates, temperatures and historical kiln fields.
alter table public.pavilion_parts
  add column if not exists firing_duration_h numeric;

comment on column public.pavilion_parts.firing_duration_h
  is 'Firing cycle duration in hours (decimal), independent of printing duration.';

-- The project is using the ROHDE kiln; fill unset names on printed modules only.
-- Leave any already specified kiln name untouched, and do not label rammed earth blocks.
update public.pavilion_parts
set firing_kiln = 'ROHDE-kiln'
where project_id = 'pavilion-2026'
  and manufacturing_method = '3D Printing'
  and nullif(btrim(firing_kiln),'') is null;
