-- One certificate per registration. Issuance is restricted to the server's service role.
create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.registrations(id) on delete cascade,
  certificate_number text not null unique,
  token_hash text not null unique,
  token_nonce text not null,
  issued_at timestamptz not null default now(),
  issued_by uuid not null references public.profiles(id),
  revoked boolean not null default false,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revocation_reason text,
  constraint certificates_number_format check (certificate_number ~ '^AM-DMS-[0-9]{4}-[A-F0-9]{12}$')
);

create index if not exists certificates_registration_idx on public.certificates(registration_id);
alter table public.certificates enable row level security;
revoke all on public.certificates from anon, authenticated;
grant all on public.certificates to service_role;

comment on table public.certificates is 'Server-issued certificates, verified by opaque tokens against current payment and revocation records.';
