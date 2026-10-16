alter table public.registrations
  add column if not exists gender text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'registrations_gender_check'
       and conrelid = 'public.registrations'::regclass
  ) then
    alter table public.registrations
      add constraint registrations_gender_check
      check (gender is null or gender in ('Male', 'Female'));
  end if;
end $$;
