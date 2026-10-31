# Configuration

Configuration is validated at startup by `src/lib/env.ts` (zod). Demo and production modes have separate schemas. Copy `.env.example` to `.env.local` and edit; `.env.local` is git-ignored.

## Demo mode (`APP_MODE=demo`, the default)

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | `VyaporaFlow` | |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Change if you use another port |
| `DEMO_DB_PATH` | `.data/pglite` | PGlite data folder |
| `DEMO_DATABASE_URL` | unset | If set, demo mode uses this PostgreSQL database instead of PGlite. `npm run db:reset` drops and recreates it, so use a dedicated local database |
| `DEMO_UPLOAD_DIR` | `.data/uploads` | Logos and product images |

## Production mode (`APP_MODE=production`)

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | yes | `https://` URL users open. Must match Supabase Auth Site URL |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase > Project settings > API > Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | The **publishable** key (`sb_publishable_…`, Project settings > API Keys) or the legacy `anon` public key. Never the secret or service-role key |
| `DATABASE_URL` | yes, **secret** | Supabase > Connect > **Session pooler** (port 5432, works on IPv4 networks) for a computer or long-running server; Transaction pooler (port 6543) for serverless hosts such as Vercel. The default `postgres` user is required (it can `SET ROLE authenticated`) |
| `SUPABASE_STORAGE_BUCKET` | no | Default `company-assets` (created by the migrations) |
| `DATABASE_CA_CERT` | no (recommended) | Path to the database CA certificate (Supabase > Project settings > Database > SSL Configuration). Enables encrypted, verified connections. Leave `sslmode` out of `DATABASE_URL` when using it |

If any required value is missing or malformed, the app throws a `ConfigError` naming the variable; `npm start` refuses to start. There is no fallback to demo data.

### Rules

- Never prefix a secret with `NEXT_PUBLIC_`. Next.js inlines `NEXT_PUBLIC_` values into browser JavaScript.
- The app does not need `SUPABASE_SERVICE_ROLE_KEY`. Do not add it unless a new server-only feature requires it.
- Never commit `.env.local` or other secret files.

## Tests

| Variable | Notes |
|---|---|
| `TEST_DATABASE_URL` | Disposable PostgreSQL for `npm run test:pg`; each test file creates and drops its own database |
| `E2E_PORT` | Port for Playwright's app server, default `3100` |
| `E2E_BUILD` | `1` forces `next build` before end-to-end tests |
| `E2E_REUSE` | `1` reuses an already running e2e server |

## Platform settings

Administrators change these in the app (Admin > Settings), stored in `platform_settings`: `default_search_radius_km` (50), `allowed_search_radii_km` ([10, 25, 50, 60]), `marketplace_enabled`, `new_wholesalers_listed`, and `support_email` (a placeholder that is hidden on the contact page until you replace it).
