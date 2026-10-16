-- Add participant age, residential address and device information.
-- Nullable columns preserve existing registration rows; new public registrations
-- require all three values through the Netlify registration function.
alter table public.registrations
  add column if not exists age smallint,
  add column if not exists residential_address text,
  add column if not exists device_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'registrations_age_range_check' and conrelid = 'public.registrations'::regclass) then
    alter table public.registrations add constraint registrations_age_range_check check (age is null or age between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'registrations_residential_address_length_check' and conrelid = 'public.registrations'::regclass) then
    alter table public.registrations add constraint registrations_residential_address_length_check check (residential_address is null or length(trim(residential_address)) between 1 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'registrations_device_type_check' and conrelid = 'public.registrations'::regclass) then
    alter table public.registrations add constraint registrations_device_type_check check (device_type is null or device_type in ('PC', 'Smartphone', 'Both'));
  end if;
end $$;
