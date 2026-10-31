# Security

## Layers

1. **Route guards** (`src/proxy.ts`): visitors without a session cookie are sent to `/login` before private pages render. This is a convenience, not the protection.
2. **Server checks** (`src/server/viewer.ts`): every private page and action resolves the user and requires the right account type, membership and role. Company IDs from cookies or forms are accepted only if the user is an active member of that company.
3. **Database functions** (`app.*`): every mutating function checks `auth.uid()`'s membership and role again, and validates state (for example allowed order transitions, stock, relationship approval).
4. **Row-Level Security**: enabled on all business tables (`supabase/migrations/20261028000800_views_and_rls.sql`). Grants are revoked from `anon` and `authenticated` first, then granted per table and column. Policies use helper functions such as `app.is_member(company)`, `app.is_staff(company)` and `app.is_assigned_worker_for_order(order)`, which derive access from `auth.uid()` and the memberships table, never from a client-supplied ID.

Because the server runs each request as the user (`SET LOCAL ROLE authenticated` plus JWT claims), a bug in a server module cannot read or change another tenant's rows: the database refuses.

## What each role can do

| Role | Can | Cannot |
|---|---|---|
| Wholesaler owner / manager | Everything in their company: catalogue, stock, orders, invoices, credit notes, payments and reversals, delivery, members, settings | See other companies' private data |
| Wholesaler staff | Orders, stock, delivery assignment, recording and allocating payments | Manage members, company settings, void invoices |
| Retailer owner / staff | Their shop's carts, orders, invoices, payments, connection requests | See other retailers, or a wholesaler's prices before approval when approval is required |
| Delivery worker | Deliveries assigned to them, the delivery address and items | See invoices, payments, stock, or other deliveries |
| Platform admin | Verify/suspend companies, support, settings, audit, health | Become admin without the CLI; admins are not created by sign-up |
| Anonymous | Public marketplace listing fields and the public catalogue of listed, active wholesalers | Any private record |

## Trusted server context (bypasses RLS)

`asService()` in `src/server/db/index.ts` runs as the table owner. It is used only for:

| Use | File | Why it cannot run as the user |
|---|---|---|
| Migrations and seeding | `scripts/db.ts` | Schema changes |
| Demo sign-in, sessions and password resets | `src/server/auth/demo.ts` | Runs before a user is known; replaces Supabase Auth in demo mode only |
| Reading an invitation by its token | `src/server/companies.ts` `previewInvitation` | The invitee is not a member yet; the token is a 256-bit secret stored hashed |
| Granting or revoking platform admin | `scripts/grant-admin.ts` | Deliberately outside the app; audited |
| Health checks | `src/server/admin.ts` `systemHealth` | Reads counts only |

No route or action passes user input to `asService` for business data.

## Secrets

- `DATABASE_URL` is the only server secret in production. It is read only in server code (`src/lib/env.ts`, `src/server/db`). Files that touch it import `server-only`, so importing them from a client component fails the build.
- Database TLS: without extra settings the connection is encrypted only if `DATABASE_URL` asks for it. Setting `DATABASE_CA_CERT` to the Supabase CA certificate makes the app verify the server certificate and host name (`rejectUnauthorized: true`); certificate checks are never switched off. Set it before real customers use the app.
- The Supabase **service-role key is not used** by this app.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is public by design; RLS limits what it can do.
- `scripts/check-env.ts` (runs before `npm start`) refuses to start in production when any `NEXT_PUBLIC_` variable name contains SERVICE, SECRET, PASSWORD or DATABASE. It never prints values.
- `.env.local`, `.env` and `.data/` are git-ignored and excluded from the packaged ZIP.

## Demo mode separation

- Demo mode is selected only by `APP_MODE=demo`. Production mode never reads `DEMO_*` variables and has no fallback to demo data.
- Demo data and the shared demo password come only from `supabase/seed.sql`, which `npm run db:*` refuses to run when `APP_MODE=production`, and which the Supabase CLI does not push.
- Every page shows a demo banner in demo mode.

## Other protections

- **CSRF:** server actions use Next.js origin checks; the JSON API (`/api/v1/orders`) requires a same-origin `Origin` header.
- **Rate limits:** failed sign-ins (10 per 15 minutes per email and client), registrations, password resets and the contact form.
- **Uploads:** images only (PNG, JPEG, WebP), size-limited, stored under the company's folder; Storage policies allow writes only by that company's owners and managers. Demo file serving validates the path strictly.
- **Passwords:** at least 10 characters with letters and a number; hashed with bcrypt (`pgcrypto`) in demo mode, Supabase Auth in production.
- **Audit log:** company registration, status and verification changes, admin grants, platform settings, support updates, team invitations, joins and removals, relationship decisions, invoice voids, payments recorded and reversed, purchase orders.
- **Uploads** are limited to 2 MB.
- **Idempotency:** orders and payments carry a key generated when the form renders; retries return the original record.

## Tests

`tests/integration/rls.test.ts` checks the nine isolation cases at the database level; `tests/e2e/d-security.spec.ts` repeats the important ones through the running app (pages, tampered forms, the JSON API). See [testing.md](testing.md).

## Before handling real data

- Review the legal pages and data-retention needs with a lawyer.
- Configure custom SMTP and Supabase Auth rate limits.
- Turn on Supabase Point-in-Time Recovery and database backups.
- Consider a shared rate-limit store if you run more than one instance.
- Commission an independent security review.

## Admin sign-in

`/admin/login` is a separate sign-in page for platform administrators. It uses the same password check and rate limit as `/login`, then checks `app.is_platform_admin()` in the database as that user. A non-admin account is signed straight back out and shown "This account is not a platform administrator". There is no admin sign-up anywhere; admin rights come only from `npm run admin:grant`. Every admin page and function still re-checks admin status on each request.
