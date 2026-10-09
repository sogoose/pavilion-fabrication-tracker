-- Detailed material composition / quantity per pavilion module
alter table public.pavilion_parts
  add column if not exists material_details text;
