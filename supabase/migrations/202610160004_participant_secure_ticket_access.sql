alter table public.registrations
  add column if not exists participant_access_hash text;

create unique index if not exists registrations_participant_access_hash_idx
  on public.registrations(participant_access_hash)
  where participant_access_hash is not null;

-- Keep payment verification service-only. Ticket QR tokens are derived by the
-- participant endpoint from a server secret and remain separate from portal tokens.
create or replace function public.admin_verify_payment(target_registration uuid, staff_user uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  result text;
begin
  if not exists (
    select 1 from public.profiles
    where id = staff_user and active and role in ('admin', 'finance')
  ) then
    raise exception 'not authorized';
  end if;

  update public.registrations
     set payment_status = 'Paid — Verified', updated_at = now()
   where id = target_registration and payment_status <> 'Cancelled'
   returning reference into result;

  if result is null then
    raise exception 'registration not found or cancelled';
  end if;

  if not exists (select 1 from public.tickets where registration_id = target_registration) then
    insert into public.tickets(registration_id, token_hash)
    values (target_registration, encode(digest(gen_random_bytes(32), 'sha256'), 'hex'));
  end if;

  update public.payments
     set status = 'verified', reviewed_at = now(), reviewed_by = staff_user
   where registration_id = target_registration and status = 'submitted';

  insert into public.audit_logs(actor_id, action, registration_id)
  values (staff_user, 'payment_verified', target_registration);

  return result;
end
$$;

revoke all on function public.admin_verify_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_verify_payment(uuid, uuid) to service_role;
