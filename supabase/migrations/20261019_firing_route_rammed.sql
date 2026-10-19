-- Replace the Firing Route placeholder with Rammed without misclassifying 3D prints.
-- Existing Rammed Earth modules labeled TBD genuinely belong to the Rammed route.
-- Existing 3D Printing modules labeled TBD are still undecided: use NULL, not Rammed.
-- Newly inserted routes are unset unless the user explicitly chooses a route.
alter table public.pavilion_parts
  alter column firing_route drop not null;

update public.pavilion_parts
set firing_route = case
  when manufacturing_method = 'Rammed Earth' then 'Rammed'
  else null
end
where project_id = 'pavilion-2026' and firing_route = 'TBD';

-- Keep existing Rammed Earth records consistent even if the original UI set Unfired.
update public.pavilion_parts
set firing_route = 'Rammed'
where project_id = 'pavilion-2026'
  and manufacturing_method = 'Rammed Earth'
  and firing_route = 'Unfired';

alter table public.pavilion_parts
  alter column firing_route drop default;
