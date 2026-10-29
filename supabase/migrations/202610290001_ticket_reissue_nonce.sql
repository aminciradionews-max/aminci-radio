-- Store a random per-issuance nonce so server functions can reproduce the
-- opaque QR token after the participant portal is reopened, without storing
-- the raw token or exposing it in participant records.
alter table public.tickets
  add column if not exists token_nonce text;

comment on column public.tickets.token_nonce is
  'Random nonce used with the server-side secret to derive the current QR ticket token.';
