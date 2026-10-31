# Connect VyaporaFlow to Supabase (Windows, step by step)

This guide moves VyaporaFlow from demo mode (data on your computer) to a real Supabase database and real sign-in, still running on your own computer. It takes about 20 minutes. You need the VyaporaFlow folder open in VS Code and an internet connection.

**Keep your keys private.** Everything secret goes only in the file `.env.local` on your computer. Never paste `.env.local`, your database password or any "secret" or "service_role" key into chat, email, GitHub or screenshots. VyaporaFlow does not need the secret or service-role key at all.

---

## Step 1. Create the Supabase project

1. Go to https://supabase.com and sign in (GitHub sign-in is fine).
2. Click **New project**.
3. Fill in:
   - **Name:** `vyaporaflow`
   - **Database password:** click **Generate a password**, then **copy it into a safe place** (for example a password manager). You need it in Steps 3 and 4.
     If you type your own, use only letters and numbers (no `@ # % / ?`), because those characters break the connection string.
   - **Region:** South Asia (Mumbai).
4. Click **Create new project** and wait 1-2 minutes until it says the project is ready.

## Step 2. Copy your project's values

You need three things. Open Notepad and paste them there for a moment.

| What | Where in the Supabase dashboard |
|---|---|
| **Project URL**, like `https://abcdefghijkl.supabase.co` | **Project Settings** (gear icon) > **Data API** > Project URL. Also shown under **Connect**. |
| **Publishable key**, starts with `sb_publishable_` | **Project Settings** > **API Keys**. (On older projects use the **anon public** key under "Legacy API keys". Either works.) |
| **Project reference**, the 20 letters in the URL | The part between `https://` and `.supabase.co`, e.g. `abcdefghijkl` |

Do **not** copy the "secret" or "service_role" key. It is not needed.

## Step 3. Copy the database connection string

1. In the dashboard, click **Connect** at the top of the page.
2. Choose the **Session pooler** connection string (it works on every home and office network). It looks like:
   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
   ```
3. Copy it and replace `[YOUR-PASSWORD]` (including the square brackets) with the database password from Step 1.

## Step 4. Put the database tables into Supabase

This creates all tables, security rules and functions. It does **not** copy your demo data. The demo businesses and password stay only in demo mode.

In VS Code, open a terminal (**Terminal > New Terminal**) and run these one at a time:

```powershell
npx supabase login
```
A browser window opens. Click **Authorize**. Back in VS Code you should see "You are now logged in".

```powershell
npx supabase link --project-ref abcdefghijkl
```
Use your own project reference from Step 2. When asked for the database password, paste the password from Step 1 (nothing appears while you type or paste; that is normal) and press Enter.

```powershell
npx supabase db push
```
It lists 10 migrations and asks to apply them. Type `Y` and press Enter. Wait until it says "Finished supabase db push".

Check in the dashboard: **Table Editor** shows tables such as `companies`, `orders` and `invoices`, and **Storage** shows a bucket called `company-assets`.

> If `npx supabase db push` fails with a connection or password error, see Troubleshooting at the end.

## Step 5. Sign-in settings in Supabase

In the dashboard, go to **Authentication** > **URL Configuration**:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** click **Add URL** and add `http://localhost:3000/auth/callback`

Then **Authentication** > **Sign In / Providers** > **Email**:

- Make sure **Email** is enabled.
- **Confirm email:** while you test on your computer, you can switch this **off** so new accounts can sign in immediately. Supabase's built-in email sender only sends a few emails per hour. Before real customers use the app, switch it back **on** and set up your own email sender (**Authentication** > **Emails** > SMTP Settings).

## Step 6. Fill in `.env.local`

1. In VS Code's file list, look for `.env.local` in the main VyaporaFlow folder. If it does not exist, right-click `.env.example` > **Copy**, then right-click the folder > **Paste**, and rename the copy to `.env.local`.
2. Replace everything in `.env.local` with this, using your own values:

```ini
APP_MODE=production
NEXT_PUBLIC_APP_NAME=VyaporaFlow
NEXT_PUBLIC_APP_URL=http://localhost:3000

NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijkl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxx

DATABASE_URL=postgresql://postgres.abcdefghijkl:YourPassword@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
```

3. Save the file (Ctrl+S).

Notes:
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` holds the **publishable** key (or the legacy anon key). The name is historical.
- No quotes and no spaces around `=`.
- `.env.local` is never included in the ZIP or in Git.

## Step 7. Start the app

In the terminal, stop the app if it is running (click in the terminal and press **Ctrl+C**), then:

```powershell
npm run dev
```

You should see `APP_MODE=production: using Supabase (DATABASE_URL). Skipping the local demo database.` and then `Ready`.

Check it worked: open http://localhost:3000/api/health. It should show `{"ok":true,"mode":"production"}`. The yellow "Demonstration mode" banner is gone.

If the app instead stops with "Invalid production configuration", it names the line in `.env.local` that is missing or wrong.

## Step 8. Create your accounts

The Supabase database starts empty: the demo accounts do not exist there.

1. Open http://localhost:3000/register and create your own account (choose wholesaler or retailer).
2. If "Confirm email" is on, open the email from Supabase and click the link. It brings you back to the app.
3. Complete the business setup (onboarding).

## Step 9. Make yourself the platform administrator

Nobody can become an administrator through the website. You do it once from VS Code, using the email you registered with in Step 8:

```powershell
npm run admin:grant -- you@example.com
```

It prints "Granted platform administrator access". Then sign out and use the **admin sign-in page**: http://localhost:3000/admin/login (there is also an "Admin sign in" link under the normal sign-in form). Sign in with the same email and password. You land in the admin console. **Admin > Health** should show "Mode: production", "PostgreSQL 17" and "Migrations applied (10)".

To remove admin access later: `npm run admin:grant -- you@example.com --revoke`

## Step 10. Switching between demo and Supabase

- **Back to demo:** in `.env.local` change the first line to `APP_MODE=demo`, save, stop the app (Ctrl+C) and run `npm run dev`. Your demo data is still there.
- **Back to Supabase:** change it to `APP_MODE=production` and restart.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| `npx supabase link` or `db push`: "password authentication failed" | The database password is wrong. In the dashboard: **Project Settings** > **Database** > **Reset database password**, then repeat Step 4 and update `DATABASE_URL`. |
| `db push`: "failed to connect" or a timeout | Your network may block the connection. Try another network (for example a phone hotspot), or run with `npx supabase db push --db-url "<your session pooler string from Step 3>"`. |
| `db push` says the remote has migrations that are not local | You ran SQL in this project before. Use a new, empty Supabase project. |
| App stops with "Invalid production configuration" | The message lists the wrong or missing line. Compare with Step 6. |
| Health page shows `{"ok":false}` | `DATABASE_URL` is wrong: check the password, that you used the Session pooler string, and that there are no spaces. |
| Sign-up says "Email rate limit exceeded" | Supabase's built-in sender is limited. Turn off "Confirm email" while testing (Step 5) or set up SMTP. |
| Email confirmation link opens a "site can't be reached" page or goes to the wrong place | Check Site URL and Redirect URLs in Step 5. |
| Admin sign-in says "This account is not a platform administrator" | Run Step 9 for that email first, and check the email is spelled the same. |
| "Invalid login credentials" with a demo account | Demo accounts exist only in demo mode. Register a new account (Step 8). |
| Images or logos fail to upload | Check that the `company-assets` bucket exists under **Storage**. If not, Step 4 did not finish: run `npx supabase db push` again. |
| PowerShell: "running scripts is disabled on this system" | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, answer `Y`, and try again. |

## Optional: verified encryption to the database

Recommended before real customers use the app. Download Supabase's certificate (**Project Settings** > **Database** > **SSL Configuration** > **Download certificate**), save it in the VyaporaFlow folder as `supabase-ca.crt`, and add one line to `.env.local` (keep `DATABASE_URL` exactly as it is, without `sslmode`):

```ini
DATABASE_CA_CERT=supabase-ca.crt
```

The app then encrypts the database connection and checks it is really talking to your Supabase project. You can also switch on **Enforce SSL** in the same Supabase settings page.

## Putting it on the internet

When you are ready to publish the app (for example on Vercel), follow [deployment.md](deployment.md). The Supabase project from this guide can be reused: you only add the website address to Site URL and Redirect URLs.
