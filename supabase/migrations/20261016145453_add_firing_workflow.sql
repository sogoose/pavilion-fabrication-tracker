-- Add firing as a post-production route for 3D-printed soil blocks.
alter table public.pavilion_parts
  add column if not exists firing_route text not null default 'TBD',
  add column if not exists firing_status text,
  add column if not exists firing_batch text,
  add column if not exists firing_kiln text,
  add column if not exists firing_peak_temp_c numeric,
  add column if not exists firing_program text,
  add column if not exists firing_date date,
  add column if not exists firing_dimension_before_mm numeric,
  add column if not exists firing_dimension_after_mm numeric,
  add column if not exists firing_shrinkage_pct numeric;

update public.pavilion_parts
set firing_route = 'TBD'
where firing_route is null or btrim(firing_route) = '';
