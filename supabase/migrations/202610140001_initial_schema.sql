create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin','finance','checkin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('AM-' || upper(substr(encode(gen_random_bytes(8),'hex'),1,10))),
  full_name text not null check (length(full_name) between 2 and 120),
  phone text not null,
  email text,
  state text not null,
  lga text not null,
  occupation text,
  interests text not null check (interests in ('Social Media','Cybersecurity','Artificial Intelligence','All Topics')),
  payment_status text not null default 'Pending Payment' check (payment_status in ('Pending Payment','Payment Under Review','Paid — Verified','Payment Rejected','Cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(phone), unique(email)
);
create index if not exists registrations_created_at_idx on public.registrations(created_at desc);
create index if not exists registrations_status_idx on public.registrations(payment_status);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null references public.registrations(id) on delete cascade,
  transaction_reference text, receipt_path text, status text not null default 'submitted' check(status in ('submitted','verified','rejected')),
  rejection_reason text, submitted_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references public.profiles(id)
);
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null unique references public.registrations(id) on delete cascade,
  token_hash text not null unique, revoked boolean not null default false, revoked_at timestamptz, revoked_by uuid references public.profiles(id), revocation_reason text,
  issued_at timestamptz not null default now()
);
create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null unique references public.registrations(id) on delete cascade,
  checked_in_at timestamptz not null default now(), checked_in_by uuid not null references public.profiles(id)
);
create table if not exists public.event_settings (
  id integer primary key default 1 check (id=1), event_title text not null default 'Social Media, Cybersecurity & AI Training', event_date text, deadline text, venue text, event_time text,
  bank_name text, account_name text, account_number text, payment_reference text, payment_instructions text, support_contact text,
  registration_open boolean not null default true, updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
insert into public.event_settings(id) values (1) on conflict do nothing;
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), action text not null,
  registration_id uuid references public.registrations(id), details jsonb not null default '{}', created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.registrations enable row level security;
alter table public.payments enable row level security;
alter table public.tickets enable row level security;
alter table public.check_ins enable row level security;
alter table public.event_settings enable row level security;
alter table public.audit_logs enable row level security;
create or replace function public.has_staff_role(user_id uuid, allowed_roles text[] default null) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles p where p.id=user_id and p.active and (allowed_roles is null or p.role=any(allowed_roles)))
$$;
revoke all on function public.has_staff_role(uuid,text[]) from public,anon;
grant execute on function public.has_staff_role(uuid,text[]) to authenticated,service_role;
create policy "staff read profiles" on public.profiles for select to authenticated using (id=auth.uid() or public.has_staff_role(auth.uid(),array['admin']));
create policy "staff read registrations" on public.registrations for select to authenticated using (public.has_staff_role(auth.uid(),array['admin','finance','checkin']));
create policy "staff read payments" on public.payments for select to authenticated using (public.has_staff_role(auth.uid(),array['admin','finance','checkin']));
create policy "staff read tickets" on public.tickets for select to authenticated using (public.has_staff_role(auth.uid(),array['admin','finance','checkin']));
create policy "staff read checkins" on public.check_ins for select to authenticated using (public.has_staff_role(auth.uid(),array['admin','finance','checkin']));
create policy "public read event settings" on public.event_settings for select to anon,authenticated using (true);
create policy "admin read audit" on public.audit_logs for select to authenticated using (public.has_staff_role(auth.uid(),array['admin']));
revoke all on public.registrations,public.payments,public.tickets,public.check_ins,public.audit_logs from anon,authenticated;
grant select on public.event_settings to anon,authenticated;
grant select on public.profiles,public.registrations,public.payments,public.tickets,public.check_ins to authenticated;
grant select on public.audit_logs to authenticated;

create or replace function public.admin_verify_payment(target_registration uuid, staff_user uuid) returns text language plpgsql security definer set search_path=public as $$
declare result text; begin
 if not exists(select 1 from profiles where id=staff_user and active and role in ('admin','finance')) then raise exception 'not authorized'; end if;
 update registrations set payment_status='Paid — Verified', updated_at=now() where id=target_registration and payment_status <> 'Cancelled' returning reference into result;
 if result is null then raise exception 'registration not found or cancelled'; end if;
 if not exists(select 1 from tickets where registration_id=target_registration) then insert into tickets(registration_id,token_hash) values(target_registration, encode(digest(gen_random_bytes(32),'sha256'),'hex')); end if;
 update payments set status='verified',reviewed_at=now(),reviewed_by=staff_user where registration_id=target_registration and status='submitted';
 insert into audit_logs(actor_id,action,registration_id) values(staff_user,'payment_verified',target_registration); return result;
end $$;
create or replace function public.admin_reject_payment(target_registration uuid, staff_user uuid, rejection_reason text) returns void language plpgsql security definer set search_path=public as $$ begin
 if not exists(select 1 from profiles where id=staff_user and active and role in ('admin','finance')) then raise exception 'not authorized'; end if;
 update registrations set payment_status='Payment Rejected',updated_at=now() where id=target_registration;
 update payments set status='rejected',rejection_reason=admin_reject_payment.rejection_reason,reviewed_at=now(),reviewed_by=staff_user where registration_id=target_registration and status='submitted';
 insert into audit_logs(actor_id,action,registration_id,details) values(staff_user,'payment_rejected',target_registration,jsonb_build_object('reason',rejection_reason));
end $$;
create or replace function public.admin_revoke_ticket(target_registration uuid, staff_user uuid, revocation_reason text) returns void language plpgsql security definer set search_path=public as $$ begin
 if not exists(select 1 from profiles where id=staff_user and active and role='admin') then raise exception 'not authorized'; end if;
 update tickets set revoked=true,revoked_at=now(),revoked_by=staff_user,revocation_reason=admin_revoke_ticket.revocation_reason where registration_id=target_registration;
 update registrations set payment_status='Cancelled',updated_at=now() where id=target_registration;
 insert into audit_logs(actor_id,action,registration_id,details) values(staff_user,'ticket_revoked',target_registration,jsonb_build_object('reason',revocation_reason));
end $$;
create or replace function public.staff_check_in(target_registration uuid, staff_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare output jsonb; begin
 if not exists(select 1 from profiles where id=staff_user and active and role in ('admin','checkin')) then raise exception 'not authorized'; end if;
 if exists(select 1 from check_ins where registration_id=target_registration) then select jsonb_build_object('status','ALREADY CHECKED IN','checked_in_at',checked_in_at) into output from check_ins where registration_id=target_registration; return output; end if;
 if not exists(select 1 from registrations r join tickets t on t.registration_id=r.id where r.id=target_registration and r.payment_status='Paid — Verified' and not t.revoked) then return jsonb_build_object('status','INVALID TICKET'); end if;
 insert into check_ins(registration_id,checked_in_by) values(target_registration,staff_user);
 insert into audit_logs(actor_id,action,registration_id) values(staff_user,'participant_checked_in',target_registration);
 select jsonb_build_object('status','VALID TICKET — PAYMENT VERIFIED','checked_in_at',checked_in_at) into output from check_ins where registration_id=target_registration; return output;
end $$;
revoke all on function public.admin_verify_payment(uuid,uuid),public.admin_reject_payment(uuid,uuid,text),public.admin_revoke_ticket(uuid,uuid,text),public.staff_check_in(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_verify_payment(uuid,uuid),public.admin_reject_payment(uuid,uuid,text),public.admin_revoke_ticket(uuid,uuid,text),public.staff_check_in(uuid,uuid) to service_role;
