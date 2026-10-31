# Deployment (Supabase + Vercel)

Do these steps on a new, empty Supabase project. Never run the demo seed or the local shim against it.

## 1. Supabase project

1. Create a project at supabase.com. Region: South Asia (Mumbai) for Indian users. Save the database password in a password manager.
2. Install the CLI (or use `npx supabase`) and link the project:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   ```
3. Apply migrations:
   ```bash
   npx supabase db push
   ```
   This applies `supabase/migrations/*.sql` in order: schema, functions, RLS and reference data (states, GST classes, categories, units, cities and PIN codes). The last migration enables PostGIS and creates the `company-assets` Storage bucket and its policies.
4. Check in the dashboard:
   - *Database > Tables*: RLS shows as enabled on every `public` table.
   - *Storage*: bucket `company-assets` exists and is public.
   - *Database > Extensions*: `postgis` and `pgcrypto` are enabled.

## 2. Authentication

*Authentication > Providers*: enable Email, keep **Confirm email** on.

*Authentication > URL Configuration*:
- Site URL: `https://<your-domain>`
- Redirect URLs: `https://<your-domain>/auth/callback` (add `http://localhost:3000/auth/callback` if you test production mode locally).

*Authentication > Emails / SMTP*: set up a custom SMTP sender before inviting real users. Adjust the email templates to mention VyaporaFlow.

The database trigger `on_auth_user_created` creates each user's profile from the sign-up metadata. Users choose wholesaler, retailer or delivery worker at sign-up; nobody can choose administrator.

## 3. Connection string

*Connect* in the dashboard shows the pooler strings. Use the **Transaction pooler** (port 6543) on serverless hosts such as Vercel, and the **Session pooler** (port 5432) on your own computer or a long-running server:
`postgresql://postgres.<project-ref>:<password>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`
(copy the host exactly as the dashboard shows it). This is `DATABASE_URL`. It is a secret.

Optional verified TLS: download the CA certificate (*Project Settings > Database > SSL Configuration*), ship it with the app and set `DATABASE_CA_CERT` to its path. Leave `sslmode` out of `DATABASE_URL` in that case.

The app connects with it and, for every request, switches to the `authenticated` role with the user's claims, so RLS applies exactly as for Supabase's own API.

## 4. Vercel

1. Put the project in a Git repository (the included `.gitignore` keeps `.env.local`, `.data/` and build output out).
2. In Vercel, *Add New > Project*, import the repository. Framework preset: Next.js. Build command `npm run build`, output default.
3. *Settings > Environment Variables* (Production, and Preview if you use a separate Supabase project for previews):

   | Name | Value |
   |---|---|
   | `APP_MODE` | `production` |
   | `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` |
   | `NEXT_PUBLIC_SUPABASE_URL` | project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key (`sb_publishable_…`) or legacy anon key |
   | `DATABASE_URL` | pooler URL (mark as Sensitive) |

4. Deploy, then add the domain to Supabase Auth as in step 2.

Vercel does not run `npm start`, so `scripts/check-env.ts` does not run there; the same validation runs inside the app on first request and fails with a clear error.

### Other hosts

Any Node 20.9+ host works: `npm ci && npm run build && npm start` with the same variables. `npm start` validates the environment before starting.

## 5. First administrator

1. Register the person's account normally and confirm the email.
2. From a trusted machine, in the project folder with `APP_MODE=production` and `DATABASE_URL` in `.env.local`:
   ```bash
   npm run admin:grant -- person@example.com
   # revoke: npm run admin:grant -- person@example.com --revoke
   ```
   The grant is written to `audit_logs`.

## 6. Check the deployment

- `https://<your-domain>/api/health` returns `{"ok":true,…}`.
- Admin > Health shows the database, migrations and mode.
- Register a test wholesaler and a test retailer, place and invoice an order, then delete or suspend those test companies.

## Launch checklist

- [ ] Legal review of `/terms` and `/privacy` (sections are marked).
- [ ] Support email set in Admin > Settings.
- [ ] Custom SMTP configured; email templates edited.
- [ ] Supabase backups / Point-in-Time Recovery enabled.
- [ ] Invoice format reviewed by an accountant (the app does not create e-invoices).
- [ ] More cities and PIN codes added to `geo_places`, or a geocoding service integrated.
- [ ] Independent security review.

## Updating

Add a new file in `supabase/migrations` (never edit applied ones), test locally with `npm run db:migrate` and `npm run test:pg`, then `npx supabase db push` and redeploy.
