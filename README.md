# Aminci Radio 103.9 FM Training Registration

Mobile-friendly registration and event-day check-in app for Aminci Radio and Duniyar Social Media. The supplied Aminci Radio logo is used in the site header, ticket, and favicon.

## Current implementation

The project includes the public programme page, validated registration form, duplicate checks, a participant status/evidence interface, an administrator dashboard preview, CSV export, PDF ticket rendering, QR generation, event settings form, manual check-in screen, Netlify Functions, and a Supabase schema with role-aware server operations and audit records.

The app has a local preview mode when Supabase is not configured. Local browser storage is not a production backend: preview registration, payment actions, ticket QR values, admin controls, and check-ins are not suitable for real event operations. Staff sign-in uses Supabase Auth and verifies an active staff profile. In production, participants can submit a bank reference and/or a JPG, PNG, or PDF transfer receipt through their private participant link. Receipts are stored in a private Supabase Storage bucket and remain unverified until authorized staff independently confirm the transfer. Production scanning and database-backed check-in still need staging verification before event use.

The organizer supplied the event schedule, venue, transfer account and support contacts. These values are included in the app's default settings and in the initial database seed.

## Local development

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` only after creating a Supabase project.
4. Run `npm run dev`.

Without Supabase, the app opens in preview mode and stores data in the current browser only.

## Supabase setup

1. Create a new Supabase project and apply migrations in `supabase/migrations` in filename order using the SQL editor or Supabase CLI. Existing projects should apply new migrations without rerunning destructive changes.
2. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` as Netlify function environment variables. `SUPABASE_PUBLISHABLE_KEY` is used to validate staff access tokens; `SUPABASE_SECRET_KEY` is only for privileged server-side database operations. Never use the secret key in a `VITE_` variable.
3. For local Netlify Functions, put `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` in an ignored local `.env` file. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` there for the client build. The secret key must never use a `VITE_` prefix.
4. Create the initial administrator through Supabase Auth, then insert the matching Auth user ID into `public.profiles` with role `admin`, active `true`, and a full name. Create other staff with roles `finance` or `checkin` and only after the admin account is established.
5. Populate `event_settings` with confirmed event and transfer details. Keep dashboard access limited to active staff profiles and verify each permission in a staging deployment.

The staff sign-in form checks the Supabase Auth account and its matching active row in `public.profiles`. Use Supabase Auth to create or invite the staff account, then add its Auth user UUID to `public.profiles`; never store staff passwords in SQL or environment variables.

The SQL policies deny anonymous access to participant, payment, ticket, check-in, and audit tables. Netlify privileged actions verify the caller's Supabase JWT and profile role before invoking service-only operations. Public registration uses server-side validation and checks duplicates. Each online registration receives a high-entropy private participant link; the participant portal uses it to retrieve current payment status and submit evidence. The server validates receipt MIME signatures and size, then stores files in the private `payment-receipts` bucket. Staff with admin or finance roles can open short-lived signed receipt links. Submitted evidence moves a registration to `Payment Under Review`; it never marks a registration paid. Only the manual staff payment-confirmation action issues/activates a paid ticket. Authorized administrators can issue replacement participant links for older registrations. The public ticket verification function returns only a limited set of participant fields. Configure Netlify rate limiting / edge protection before public launch.

The staff registrations dashboard subscribes to Supabase Realtime changes on `registrations` and `payments`. It refreshes the staff view when a new registration or payment update arrives, with a 30-second polling fallback while Realtime reconnects. Apply `202610160006_staff_dashboard_realtime.sql` to enable these tables in the `supabase_realtime` publication.

Only admins can permanently delete a registration. The dashboard requires a reason and a second confirmation; payment, ticket, and check-in records are deleted with it, while the audit event is retained without its participant foreign key. Apply `202610160007_admin_delete_registration.sql` before using this action in production.

## Netlify deployment

Connect the repository to Netlify. Build command is `npm run build`, publish directory is `dist`, and functions are in `netlify/functions` (already configured in `netlify.toml`). Add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` under Netlify environment variables for functions, and `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the client build. Use the same Supabase project URL and publishable key on both sides. Local `.env` files are ignored and are not uploaded with a deploy. Deploy over HTTPS, configure the custom domain and force HTTPS, then verify function logs and Supabase policies in a staging project.

## Deployment checklist

- [ ] Confirm event date, deadline, time, venue, bank details, and support contact with the organizer.
- [ ] Verify Supabase Auth sign-in, role-aware admin access, payment review, ticket revocation, and settings updates against the deployed Netlify functions.
- [ ] Apply migration `202610160005_participant_payment_evidence.sql` to create the private receipt bucket before enabling participant receipt uploads in production.
- [ ] Apply migration `202610160006_staff_dashboard_realtime.sql` so staff receive live registration and payment updates.
- [ ] Apply migration `202610160007_admin_delete_registration.sql` before enabling permanent registration deletion.
- [ ] Verify participant evidence submission, private storage, short-lived staff receipt links, payment review, ticket activation/download and token retrieval in a staging deployment.
- [ ] Verify production QR scanning and database-backed check-in UI.
- [ ] Add request rate limits and abuse monitoring to public endpoints.
- [ ] Test duplicate registration, RLS access, staff permission boundaries, manual payment verification, ticket revocation, current QR lookup, repeat check-in, mobile layouts, and PDF output in a staging deployment.
- [ ] Confirm no real keys or account credentials are committed.
