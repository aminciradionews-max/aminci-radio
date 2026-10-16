-- Preserve audit history when an admin permanently deletes a registration.
alter table public.audit_logs
  drop constraint if exists audit_logs_registration_id_fkey;

alter table public.audit_logs
  add constraint audit_logs_registration_id_fkey
  foreign key (registration_id) references public.registrations(id) on delete set null;

create or replace function public.admin_delete_registration(
  target_registration uuid,
  staff_user uuid,
  deletion_reason text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_reference text;
begin
  if not exists (
    select 1 from public.profiles
    where id = staff_user and active and role = 'admin'
  ) then
    raise exception 'not authorized';
  end if;

  if length(trim(coalesce(deletion_reason, ''))) < 3 then
    raise exception 'deletion reason required';
  end if;

  select reference into deleted_reference
  from public.registrations
  where id = target_registration
  for update;

  if deleted_reference is null then
    raise exception 'registration not found';
  end if;

  insert into public.audit_logs(actor_id, action, registration_id, details)
  values (
    staff_user,
    'registration_deleted',
    target_registration,
    jsonb_build_object('reference', deleted_reference, 'reason', left(trim(deletion_reason), 500))
  );

  -- Payment, ticket and check-in records cascade with the deleted registration.
  -- Audit references are set null, preserving the activity history.
  delete from public.registrations where id = target_registration;

  return deleted_reference;
end
$$;

revoke all on function public.admin_delete_registration(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_delete_registration(uuid, uuid, text) to service_role;
