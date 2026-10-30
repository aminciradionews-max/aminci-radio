alter table public.event_settings
  alter column certificate_watermark_opacity set default 0.085;

-- 0.075 was this feature's original default; preserve any custom admin-selected value.
update public.event_settings
set certificate_watermark_opacity = 0.085
where certificate_watermark_opacity = 0.075;
