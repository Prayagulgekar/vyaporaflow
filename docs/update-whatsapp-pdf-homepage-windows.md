# Update: WhatsApp messages, PDFs and homepage (Windows, step by step)

This update keeps your Supabase project, your `.env.local`, your accounts and all your data. **There is no database migration and no new setting.** Do not run `npx supabase db push` or `db:reset` for this update.

Commands are for **PowerShell** (in VS Code: **Terminal → New Terminal**). Paste one block at a time. The paths below assume your project is in `C:\Users\Asus\Downloads\vyaporaflow`, as in the earlier guides; change them if yours is elsewhere.

## 1. Stop the app

In the terminal where `npm run dev` is running, press **Ctrl + C** (type `Y` if asked).

## 2. Back up your project folder

```powershell
robocopy "C:\Users\Asus\Downloads\vyaporaflow" "C:\Users\Asus\Downloads\vyaporaflow-backup-2026-11-02" /E /XD node_modules .next
```

Exit codes 0 to 7 mean it worked. The backup includes your `.env.local`, so keep it on your own computer.

## 3. Unzip the update next to your project

Save the ZIP to Downloads as `vyaporaflow-whatsapp-pdf-homepage.zip`, then:

```powershell
Expand-Archive -Path "C:\Users\Asus\Downloads\vyaporaflow-whatsapp-pdf-homepage.zip" -DestinationPath "C:\Users\Asus\Downloads\vyaporaflow-update-2026-11-02" -Force
```

## 4. Copy the files into your project

```powershell
robocopy "C:\Users\Asus\Downloads\vyaporaflow-update-2026-11-02\vyaporaflow" "C:\Users\Asus\Downloads\vyaporaflow" /E /XF .env.local .env /XD node_modules .next .data .temp
```

This adds and overwrites project files only; it deletes nothing and never touches `.env.local`. Check your settings file is still there:

```powershell
cd "C:\Users\Asus\Downloads\vyaporaflow"
Test-Path .env.local
```

It must print `True`.

## 5. Install the two new packages

```powershell
npm install
```

This adds `pdf-lib` and `@pdf-lib/fontkit` (free, used to create the PDFs).

## 6. Check and start

```powershell
npm run typecheck
npm run dev
```

Open http://localhost:3000. You should see the new homepage.

## 7. Try it

1. Sign in as a wholesaler and open **Retailers**, then a retailer.
2. Click **WhatsApp**: choose a message, check it, click **Open WhatsApp**. WhatsApp Web opens with the chat and the message; press Send there if you want to send it.
3. Click **Send balance due**: click **Download PDF** to see the PDF, or **Share on WhatsApp** (on a computer the PDF downloads and WhatsApp opens; attach the PDF with the paperclip → Document, then press Send).
4. On the same page choose a **Month** and click **Prepare monthly statement**.
5. Open any invoice: **Download PDF**. Open any payment: **Receipt PDF**.

If a WhatsApp button says the number is not valid, fix the retailer's phone in their shop profile (a 10-digit mobile number such as `98765 43210`).

## 8. Optional: run the tests (they never touch your real database)

```powershell
npm run test:unit
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
```

`test:e2e` builds the app and uses a throwaway demo database in `.data\e2e`. If you previously built the app, run `$env:E2E_BUILD="1"; npm run test:e2e` so it rebuilds with the new code.

## If something goes wrong

Stop the app, move the updated folder aside and put the backup back in its place:

```powershell
cd "C:\Users\Asus\Downloads"
Rename-Item "vyaporaflow" "vyaporaflow-updated-not-working"
robocopy "C:\Users\Asus\Downloads\vyaporaflow-backup-2026-11-02" "C:\Users\Asus\Downloads\vyaporaflow" /E
cd "C:\Users\Asus\Downloads\vyaporaflow"
npm install
npm run dev
```

Your `.env.local` is in the backup. Nothing in the database changed, so there is nothing to undo there.
