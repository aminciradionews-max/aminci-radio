alter table public.event_settings
  add column if not exists station_name text not null default 'AMINCI RADIO 103.9 FM KANO',
  add column if not exists station_address text not null default 'No. 71 Sharada Industrial Area Kano, Nigeria',
  add column if not exists station_phone text not null default '+234 902 555 5800',
  add column if not exists station_website text not null default 'www.aminciradio.com.ng',
  add column if not exists station_social_links jsonb not null default '{}'::jsonb,
  add column if not exists certificate_logo_url text,
  add column if not exists certificate_watermark_enabled boolean not null default true,
  add column if not exists certificate_watermark_text text not null default 'AMINCI RADIO 103.9 FM KANO · OFFICIAL CERTIFICATE',
  add column if not exists certificate_watermark_opacity numeric not null default 0.075,
  add column if not exists certificate_watermark_font_size integer not null default 7,
  add column if not exists certificate_watermark_angle integer not null default -28,
  add column if not exists certificate_watermark_spacing integer not null default 64,
  add column if not exists certificate_watermark_color text not null default '#c5ad44',
  add column if not exists certificate_border_enabled boolean not null default true;

alter table public.event_settings
  drop constraint if exists event_settings_certificate_watermark_opacity_check,
  add constraint event_settings_certificate_watermark_opacity_check check (certificate_watermark_opacity between 0.025 and 0.14),
  drop constraint if exists event_settings_certificate_watermark_font_size_check,
  add constraint event_settings_certificate_watermark_font_size_check check (certificate_watermark_font_size between 5 and 12),
  drop constraint if exists event_settings_certificate_watermark_angle_check,
  add constraint event_settings_certificate_watermark_angle_check check (certificate_watermark_angle between -55 and -12),
  drop constraint if exists event_settings_certificate_watermark_spacing_check,
  add constraint event_settings_certificate_watermark_spacing_check check (certificate_watermark_spacing between 34 and 100),
  drop constraint if exists event_settings_certificate_watermark_color_check,
  add constraint event_settings_certificate_watermark_color_check check (certificate_watermark_color ~ '^#[0-9A-Fa-f]{6}$');

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('certificate-assets', 'certificate-assets', true, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png'];

comment on column public.event_settings.station_social_links is 'Administrator-configured official social URLs. Empty platforms are hidden from certificates.';
comment on column public.event_settings.certificate_logo_url is 'Public official station logo asset used in generated certificates.';
