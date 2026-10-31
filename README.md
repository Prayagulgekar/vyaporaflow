# VyaporaFlow

Wholesale management and B2B ordering for Indian wholesalers, distributors and the retailers who buy from them.

- **Wholesalers** manage products (units, variants, packaging, attributes), stock, retailer orders, GST invoices, payments, outstanding balances, delivery and reports.
- **Retailers** find nearby wholesalers, order from each one with a separate cart, reorder, and see invoices, payments and balances. The retailer screens are designed for phones first.
- **Delivery workers** see only the deliveries assigned to them, record each step, and record the cash or UPI actually collected from the shop. The office sees each worker's cash on **Cash Collections** and confirms handovers (see [docs/cash-collections.md](docs/cash-collections.md)).
- **Platform administrators** verify and suspend companies, handle support requests, change platform settings and read the audit log.

> **Status:** this is a working application with tests, not a certified production system. Read [Known limitations](#known-limitations) before using it with real businesses. Legal pages (terms, privacy) contain placeholders that need review by a lawyer.

## Contents

1. [Project overview](#project-overview)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Local demonstration](#local-demonstration)
5. [Supabase configuration](#supabase-configuration)
6. [Environment variables](#environment-variables)
7. [Running the application](#running-the-application)
8. [Testing](#testing)
9. [Database](#database)
10. [Deployment](#deployment)
11. [Security](#security)
12. [Known limitations](#known-limitations)
13. [Troubleshooting](#troubleshooting)

More detail lives in [`docs/`](docs): [cash collections](docs/cash-collections.md), [architecture](docs/architecture.md), [configuration](docs/configuration.md), [security](docs/security.md), [testing](docs/testing.md) and [deployment](docs/deployment.md).

---

## Project overview

VyaporaFlow is one Next.js application (App Router, React Server Components, strict TypeScript, Tailwind CSS) backed by PostgreSQL.

```
Browser ──► Next.js server (pages, server actions, /api routes)
                │   validates input (zod), resolves the signed-in user
                ▼
           src/server/*  ── one transaction per request, run AS the user:
                │           SET LOCAL ROLE authenticated + JWT claims
                ▼
           PostgreSQL  ── Row-Level Security on every business table
                          app.* functions hold the business rules
                          (pricing, stock reservation, invoices, ledger)
```

It runs in two explicitly separate modes:

| | Demo mode (`APP_MODE=demo`) | Production mode (`APP_MODE=production`) |
|---|---|---|
| Database | Embedded PostgreSQL ([PGlite](https://pglite.dev)) in `.data/pglite`, or a local PostgreSQL server | Supabase PostgreSQL |
| Sign-in | Local email and password (demo accounts are seeded) | Supabase Auth |
| Files | `.data/uploads` | Supabase Storage |
| Email | Not sent. Reset and invitation links are shown on screen and labelled as simulated | Supabase Auth emails (password reset, confirmation) |
| Missing config | Sensible local defaults | Startup fails with a clear error. Never falls back to demo data |

Both modes run **the same migrations, RLS policies and database functions**, so the demo exercises the real security model.

Main code layout:

```
src/app/            routes: (marketing) public site, (auth), /w wholesaler, /r retailer,
                    /d delivery, /admin, /api
src/features/       server actions and feature components per role
src/server/         trusted server modules: data access, validation, auth, storage
src/domain/         pure TypeScript rules: money, GST, pricing, units, order states, permissions
src/components/     shared UI
supabase/migrations SQL schema, RLS, functions (applied in order)
supabase/seed.sql   fictional demo data (demo and test databases only)
tests/              unit, integration (incl. RLS and concurrency), e2e (Playwright)
scripts/            database, admin, environment check, screenshots, e2e server
```

See [docs/architecture.md](docs/architecture.md) for the data model, order lifecycle and money handling.

## Requirements

- **Node.js 20.9 or newer** (tested with Node 22). Check with `node -v`.
- **npm 10** or newer (comes with Node).
- Nothing else for demo mode. PGlite is installed as an npm package.
- Optional: **PostgreSQL 15+** (16 tested) to run the concurrency tests or to use a server database in demo mode. PostGIS is used when available.
- For production: a **Supabase** project and a host for Next.js (instructions use **Vercel**).
- For end-to-end tests: Playwright's Chromium (`npx playwright install chromium`).

Works on macOS, Linux and Windows. Commands below are for a terminal (on Windows use PowerShell or the VS Code terminal).

## Installation

```bash
cd vyaporaflow
npm install
```

That is all for demo mode: no `.env.local` is needed, because demo mode has defaults. To change anything, copy the template:

```bash
cp .env.example .env.local      # Windows PowerShell: Copy-Item .env.example .env.local
```

## Local demonstration

```bash
npm run dev
```

`npm run dev` first runs `npm run db:setup`, which creates the demo database in `.data/pglite`, applies all migrations and loads the fictional demo data (only if the database is empty). Then open **http://localhost:3000**.

Data persists between restarts. To start over:

```bash
npm run db:reset     # deletes .data/pglite and recreates it with fresh demo data
```

### Demo accounts

All demo accounts use the password **`VyaporaDemo#2026`**. It exists only in the demo seed and is shown on the login page in demo mode.

| Role | Email | What to try |
|---|---|---|
| Wholesaler owner | `sahyadri.owner@vyaporaflow.test` | Orders, products, invoices, payments, balances, delivery |
| Wholesaler staff | `sahyadri.staff@vyaporaflow.test` | Same company, staff permissions |
| Second wholesaler | `annapurna.owner@vyaporaflow.test` | Auto-approves new retailers |
| Retailer | `ganesh.retailer@vyaporaflow.test` | Ordering from two wholesalers, invoices, payments |
| Retailer | `omsai.retailer@vyaporaflow.test` | |
| Retailer (pending approval) | `laxmi.retailer@vyaporaflow.test` | Waiting for Sahyadri to approve |
| Delivery worker | `ravi.delivery@vyaporaflow.test` | Assigned deliveries (phone layout) |
| Delivery worker | `sunil.delivery@vyaporaflow.test` | |
| Platform admin | `admin@vyaporaflow.test` | Companies, verification, support, audit, health. Sign in at `/admin/login` |

You can also register a new wholesaler or retailer from `/register`. All businesses, people, brands and products in the demo are fictional.

## Supabase configuration

Beginner walkthrough for running locally against Supabase (Windows, VS Code): [docs/supabase-setup-windows.md](docs/supabase-setup-windows.md). Hosting: [docs/deployment.md](docs/deployment.md). Short version:

1. **Create a project** at [supabase.com](https://supabase.com). Choose the Mumbai (`ap-south-1`) region for Indian users.
2. **Apply the migrations** with the [Supabase CLI](https://supabase.com/docs/guides/cli):
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push          # applies supabase/migrations in order
   ```
   `supabase/config.toml` keeps seeding disabled, so `db push` never loads demo data. Do **not** run `supabase/seed.sql` or `supabase/local/supabase_shim.sql` on a Supabase project. The seed contains a shared demo password and the shim recreates objects Supabase already provides.
3. **Authentication** (Dashboard > Authentication):
   - Enable the Email provider. Keep "Confirm email" on.
   - Set *Site URL* to your app URL (for example `https://vyaporaflow.example.in`).
   - Add `https://<your-domain>/auth/callback` to *Redirect URLs*.
   - Configure custom SMTP before launch; the built-in sender is rate-limited.
4. **Storage:** migration `…001000_optional_postgis_storage.sql` creates the public `company-assets` bucket and its policies. Check it exists under Storage. Product images and logos are public by design; do not upload private documents there.
5. **PostGIS:** the same migration enables PostGIS when the project offers it (Supabase does) and switches radius search to `ST_DWithin`.
6. **Environment variables:** set the production variables below in `.env.local` (local) or in your host's settings. `NEXT_PUBLIC_SUPABASE_ANON_KEY` takes the publishable key (`sb_publishable_…`) or the legacy anon key. For `DATABASE_URL` use the *Session pooler* string (port 5432) locally and on long-running servers, and the *Transaction pooler* (port 6543) on serverless hosts such as Vercel. With `APP_MODE=production`, `npm run dev` uses Supabase and skips the local demo database.
7. **First administrator:** there is no way to become an admin through the app. After that person has registered, run once from the project folder (it reads `APP_MODE` and `DATABASE_URL` from `.env.local`):
   ```bash
   npm run admin:grant -- person@example.com
   ```
   Administrators then sign in at `/admin/login` (linked from the normal sign-in page). That page signs in only platform administrators and turns other accounts away; it has no sign-up.

## Environment variables

| Variable | Mode | Required | Secret? | Purpose |
|---|---|---|---|---|
| `APP_MODE` | both | yes (default `demo`) | no | `demo` or `production` |
| `NEXT_PUBLIC_APP_NAME` | both | no | no | Display name, default `VyaporaFlow` |
| `NEXT_PUBLIC_APP_URL` | both | production | no | Public URL, used for auth redirects and same-origin checks |
| `DEMO_DB_PATH` | demo | no | no | PGlite folder, default `.data/pglite` |
| `DEMO_DATABASE_URL` | demo | no | local only | Use a local PostgreSQL server instead of PGlite |
| `DEMO_UPLOAD_DIR` | demo | no | no | Upload folder, default `.data/uploads` |
| `NEXT_PUBLIC_SUPABASE_URL` | production | yes | no | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production | yes | no (public by design) | Browser key, limited by RLS |
| `DATABASE_URL` | production | yes | **yes, server only** | Supabase pooler connection string (Session pooler locally) |
| `SUPABASE_STORAGE_BUCKET` | production | no | no | Default `company-assets` |
| `DATABASE_CA_CERT` | production | no | no | Path to Supabase's CA certificate; turns on verified TLS to the database |
| `TEST_DATABASE_URL` | tests | for `test:pg` | local only | Disposable PostgreSQL for concurrency tests |

`.env.example` contains placeholders only. The app does **not** use the Supabase service-role key. `npm start` runs `scripts/check-env.ts` first, which refuses to start in production if configuration is missing or if any `NEXT_PUBLIC_` variable looks like a secret. Full reference: [docs/configuration.md](docs/configuration.md).

## Running the application

| Command | What it does |
|---|---|
| `npm run dev` | Prepare the demo database, then start the dev server on http://localhost:3000 |
| `npm run build` | Production build |
| `npm start` | Check the environment, then serve the production build |
| `npm run typecheck` | TypeScript, strict |
| `npm run lint` | ESLint |

To try the production build locally in demo mode: `npm run build && npm start`.

## Testing

| Command | What it covers | Needs |
|---|---|---|
| `npm run test:unit` | Money (exact paise arithmetic), discounts, GST split, pricing, unit conversion, quantity rules, order states, invoice totals, allocations, balances, permissions, env validation | nothing |
| `npm run test:integration` | Server modules against a fresh in-memory database: product creation, stock, cart, order submission, reservation, invoices, payments, allocations, reversals, ledger reconciliation, delivery assignment, constraints, SQL/TypeScript pricing parity, idempotency, and **RLS cases 1-9** | nothing (PGlite) |
| `npm run test:security` | Only the RLS and tenant isolation tests | nothing |
| `npm run test:pg` | All integration tests on real PostgreSQL, **including concurrency** (last-stock race, duplicate orders and payments) | `TEST_DATABASE_URL` to a disposable server |
| `npm test` | Unit and integration | nothing |
| `npm run test:e2e` | Playwright workflows A-E plus forms and admin sign-in in Chromium against a throwaway demo database (`.data/e2e`) on port 3100 | `npx playwright install chromium` once |

Example for PostgreSQL concurrency tests:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:pg
```

Each test file creates its own database (`vf_test_<random>`) and drops it afterwards. Never point `TEST_DATABASE_URL` at production. See [docs/testing.md](docs/testing.md) for what each workflow checks.

## Database

- **Schema** is in `supabase/migrations`, applied in file-name order:
  `0100` foundation (profiles, companies, memberships, settings, audit) · `0200` catalogue and inventory · `0300` orders, invoices, payments, ledger, deliveries, purchasing · `0400`-`0700` business functions · `0800` views, grants and RLS · `0900` reference data (states, GST classes, categories, units, cities and PIN codes) · `1000` optional PostGIS and Storage.
- **Money** is `numeric(14,2)` everywhere and exact decimal strings in TypeScript. Never floating point.
- **Migrations, local:** `npm run db:migrate` applies pending ones; `npm run db:status` lists applied ones. They are tracked in `vf_meta.schema_migrations`.
- **Migrations, Supabase:** `npx supabase db push`.
- **Seed:** `npm run db:seed` loads the fictional demo data (demo and test databases only; the command refuses to run when `APP_MODE=production`).
- **Reset:** `npm run db:reset` deletes and recreates the demo database.

## Deployment

1. Set up Supabase as above.
2. Push this project to a Git repository and import it in Vercel (framework preset: Next.js).
3. Add the production environment variables in Vercel > Project > Settings > Environment Variables. Mark `DATABASE_URL` as sensitive. Do not add any `NEXT_PUBLIC_` secret.
4. Deploy. Then add the deployment URL to Supabase Auth *Site URL* and *Redirect URLs*.
5. Register the first account and grant admin with `npm run admin:grant` (see above).
6. Check `https://<your-domain>/api/health` and the admin Health page.

Details, other hosts and a launch checklist: [docs/deployment.md](docs/deployment.md).

## Security

- **Row-Level Security** is enabled on every table with business data. Policies check membership of the company that owns the row, never a company ID supplied by the client. Grants start from nothing and add only what each role needs.
- **Every request runs as the signed-in user.** The server opens a transaction with `SET LOCAL ROLE authenticated` and the user's JWT claims, so the database enforces RLS for all reads and writes, in both modes.
- **Business rules live in the database** (`app.*` functions): prices, discounts, taxes and totals are computed from database records; stock is reserved with row locks; invoices, payments and ledger entries are posted atomically; order events are append-only.
- **Authorization** is checked server-side in `src/server/viewer.ts` and again by RLS. Hiding a button is never the only protection.
- **Secrets:** `DATABASE_URL` is server-only. No secret uses a `NEXT_PUBLIC_` prefix. The Supabase service-role key is not used. `.env.local` is git-ignored.
- **Trusted server context** (bypasses RLS) is used only for: migrations and seeding, demo-mode sessions and password resets, reading an invitation by its token before sign-in, the `admin:grant` command and health checks. The list and reasons are in [docs/security.md](docs/security.md).
- **Administrators** are never created by sign-up. Only the `admin:grant` command, run by someone with database access, creates one, and it is audited.
- Same-origin checks protect the JSON API; server actions have Next.js's built-in origin checks. Sign-in, registration and the contact form are rate-limited.
- Demo mode shows a banner on every page and uses only fictional data.

## Known limitations

- **No online payment gateway.** Payments are recorded manually (cash, UPI reference, bank transfer, cheque). Nothing is charged or verified with a bank.
- **No SMS, OTP or WhatsApp integration.** WhatsApp buttons are plain `wa.me` links that open the user's own WhatsApp. Phone numbers are not verified.
- **Email in demo mode is simulated**: password-reset and invitation links are shown on screen. In production, password reset and confirmation emails come from Supabase Auth; invitations are still shared as a link by the inviter.
- **GST:** invoices show GSTIN, HSN, CGST/SGST/IGST and place of supply, but they are **not e-invoices** (no IRN/QR from the GST portal) and there is no GSTR filing export. GSTIN is checked for format only, not against the GST portal. Have an accountant review invoice formats before use.
- **Location:** PIN codes and cities are resolved from a small bundled list (a few dozen cities and PIN codes, mostly around Pune and Mumbai). There is no map or geocoding service. Device GPS is opt-in.
- **Supabase mode was verified end to end against a local Supabase stack** (Supabase CLI 2.122, PostgreSQL 17 with PostGIS): migrations, sign-up, onboarding, products with image upload to Storage, orders through delivery, GST invoice, payment, RLS through Supabase's REST API, `admin:grant` and the health page. It has **not** yet been run against a hosted supabase.com project, so hosted email confirmation, SMTP and the pooler URLs are untested.
- **Languages:** the interface is English. The preferred language is recorded for future translation.
- Rate limiting is in memory per server instance. Use Supabase or a shared store when running several instances.
- PGlite (demo default) allows one connection at a time; concurrency is tested on PostgreSQL instead.
- Legal pages (`/terms`, `/privacy`) are templates with sections marked for legal review.
- Pricing page shows "Plans coming soon": there is no billing or subscription system.

## Troubleshooting

| Problem | Fix |
|---|---|
| `The demo database has not been initialised` | Run `npm run db:setup` (or use `npm run dev`, which does it first). |
| Demo data looks wrong or a migration failed half-way | `npm run db:reset` |
| `Invalid production configuration` at start | A production variable is missing or malformed. The message lists which. Compare with `.env.example`. |
| `EADDRINUSE: port 3000` | Another app uses the port: `npm run dev -- -p 3001` and set `NEXT_PUBLIC_APP_URL` accordingly. |
| `Too many sign-in attempts` | Ten failed attempts in 15 minutes per email and address. Wait, or restart the server in demo mode. |
| Sign-in works locally but not on Vercel | Add the Vercel URL to Supabase Auth *Site URL* and *Redirect URLs*; set `NEXT_PUBLIC_APP_URL` to the same URL. |
| Supabase: `permission denied for schema app` or missing functions | Migrations were not all applied. Run `npx supabase db push` again and check the output. |
| `npm run test:pg` says to set `TEST_DATABASE_URL` | Start a local PostgreSQL and export the URL (see Testing). |
| Playwright: `Executable doesn't exist` | `npx playwright install chromium` |
| Node version errors on install | Install Node 20.9+ (22 recommended) from nodejs.org or with `nvm install 22`. |
| `npm install` fails on PGlite on an old OS | PGlite is WebAssembly and needs no compiler; update Node first. |
