-- Enable Realtime events for the staff dashboard. Existing table-level grants
-- and RLS policies remain responsible for deciding which staff can read rows.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'registrations'
    ) then
      execute 'alter publication supabase_realtime add table public.registrations';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments'
    ) then
      execute 'alter publication supabase_realtime add table public.payments';
    end if;
  end if;
end
$$;
