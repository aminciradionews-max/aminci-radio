# Aminci Radio 103.9 FM Training Registration

Mobile-friendly registration and event-day check-in app for Aminci Radio and Duniyar Social Media. The supplied Aminci Radio logo is used in the site header, ticket, and favicon.

## Current implementation

The project includes the public programme page, validated registration form, duplicate checks, a participant status/evidence interface, an administrator dashboard preview, CSV export, PDF ticket rendering, QR generation, event settings form, manual check-in screen, Netlify Functions, and a Supabase schema with role-aware server operations and audit records.

The app has a local preview mode when Supabase is not configured. Local browser storage is not a production backend: preview registration, payment actions, ticket QR values, admin controls, and check-ins are not suitable for real event operations. The Supabase registration and staff actions require the deployment configuration below. Staff UI authentication, participant expiring-link access, receipt storage, production scanning integration, ticket-token delivery, and UI-to-function wiring still need completion before production use. Do not collect or confirm real payments until those items are implemented and independently verified.

The organizer supplied the event schedule, venue, transfer account and support contacts. These values are included in the app's default settings and in the initial database seed.

## Local development

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only after creating a Supabase project.
4. Run `npm run dev`.

Without Supabase, the app opens in preview mode and stores data in the current browser only.

## Supabase setup

1. Create a new Supabase project and apply `supabase/migrations/202610140001_initial_schema.sql` using the SQL editor or Supabase CLI.
2. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as Netlify function environment variables. Never use the secret key in a `VITE_` variable.
3. For local Netlify Functions, put `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in an ignored local `.env` file. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` there for the client build. The secret key must never use a `VITE_` prefix.
4. Create the initial administrator through Supabase Auth, then insert the matching Auth user ID into `public.profiles` with role `admin`, active `true`, and a full name. Create other staff with roles `finance` or `checkin` and only after the admin account is established.
5. Populate `event_settings` with confirmed event and transfer details. Restrict dashboard access until authenticated UI integration has been completed.

The SQL policies deny anonymous access to participant, payment, ticket, check-in, and audit tables. Netlify privileged actions verify the caller's Supabase JWT and profile role before invoking service-only operations. Public registration uses server-side validation and checks duplicates. The public ticket verification function returns only a limited set of participant fields. Configure Netlify rate limiting / edge protection before public launch.

## Netlify deployment

Connect the repository to Netlify. Build command is `npm run build`, publish directory is `dist`, and functions are in `netlify/functions` (already configured in `netlify.toml`). Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` under Netlify's server-side environment variables, and `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the client build. Local `.env` files are ignored and are not uploaded with a deploy. Deploy over HTTPS, configure the custom domain and force HTTPS, then verify function logs and Supabase policies in a staging project.

## Deployment checklist

- [ ] Confirm event date, deadline, time, venue, bank details, and support contact with the organizer.
- [ ] Finish and verify Supabase Auth sign-in, role-aware admin UI, participant expiring access links, and evidence uploads to a private Storage bucket.
- [ ] Connect payment review, settings, receipt review, ticket activation/download and token retrieval, scanning, and check-in UI to the Netlify functions.
- [ ] Add request rate limits and abuse monitoring to public endpoints.
- [ ] Test duplicate registration, RLS access, staff permission boundaries, manual payment verification, ticket revocation, current QR lookup, repeat check-in, mobile layouts, and PDF output in a staging deployment.
- [ ] Confirm no real keys or account credentials are committed.
