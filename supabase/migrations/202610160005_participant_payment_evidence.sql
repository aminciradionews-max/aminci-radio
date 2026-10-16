-- Private receipt storage. Only server functions using the service role may
-- upload or issue signed review links; browser clients receive no bucket policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts',
  'payment-receipts',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create index if not exists payments_registration_submitted_at_idx
  on public.payments (registration_id, submitted_at desc);

