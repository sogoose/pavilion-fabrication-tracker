alter table public.pavilion_parts
  add column if not exists motor_speed numeric,
  add column if not exists motor_speed_manual_adjustment_pct numeric,
  add column if not exists air_pressure_bar numeric,
  add column if not exists first_layer_height_mm numeric,
  add column if not exists layer_height_mm numeric,
  add column if not exists print_duration_min numeric;
