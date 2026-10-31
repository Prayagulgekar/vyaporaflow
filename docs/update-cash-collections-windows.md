# Update: delivery cash collections (Windows, step by step)

This update adds cash collection on delivery, the **Cash Collections** page and cash handovers. It keeps your Supabase project, your `.env.local`, your accounts and all your data. It adds **one** new database migration and changes nothing that already exists in your database.

Commands are for **PowerShell** (in VS Code: **Terminal → New Terminal**). Paste one block at a time.

## 1. Stop the app

In the terminal where `npm run dev` is running, press **Ctrl + C**. If it asks "Terminate batch job (Y/N)?", type `Y` and press Enter.

## 2. Make a backup copy of your project folder

```powershell
robocopy "C:\Users\Asus\Downloads\vyaporaflow" "C:\Users\Asus\Downloads\vyaporaflow-backup-2026-10-29" /E /XD node_modules .next
```

robocopy prints a summary table. That is normal; exit codes 0 to 7 mean it worked. The backup includes your `.env.local`, so keep it on your own computer.

## 3. Unzip the update next to your project

Save the ZIP to your Downloads folder as `vyaporaflow-cash-collections.zip`, then:

```powershell
Expand-Archive -Path "C:\Users\Asus\Downloads\vyaporaflow-cash-collections.zip" -DestinationPath "C:\Users\Asus\Downloads\vyaporaflow-update" -Force
```

## 4. Copy the changed files into your project

```powershell
robocopy "C:\Users\Asus\Downloads\vyaporaflow-update\vyaporaflow" "C:\Users\Asus\Downloads\vyaporaflow" /E /XF .env.local .env /XD node_modules .next .data .temp
```

- This only adds and overwrites project files. It deletes nothing.
- `.env.local` is not in the ZIP, and `/XF .env.local` makes doubly sure it is never touched.
- `supabase\.temp` (where the Supabase CLI remembers your linked project) is skipped, so you stay linked.

Check that your settings file is still there:

```powershell
cd "C:\Users\Asus\Downloads\vyaporaflow"
Test-Path .env.local
```

It must print `True`.

## 5. Install packages

No new packages were added, but this keeps things in step:

```powershell
npm install
```

## 6. Apply the new database migration

### What it does (read this first)

`supabase/migrations/20261029000100_delivery_cash_collections.sql`:

- **Adds** three tables: `delivery_collections`, `cash_handovers`, `cash_handover_items`, and one read-only view, `delivery_collection_balances`. All of them start empty.
- **Adds** database functions for recording a collection, completing a delivery together with its payment, confirming and reversing a handover, and reading what is due on an order.
- **Adds** one trigger: when an invoice is issued, payments collected on that order's delivery are applied to it.
- **Widens** two allowed-value lists in the ledger, so it accepts the new account `CASH_IN_TRANSIT` (cash held by delivery staff) and two new entry types (handover and handover reversal). Existing ledger rows are not touched.
- **Updates** `app.reverse_payment` so that reversing a payment collected on a delivery is handled correctly. Reversing any other payment works exactly as before.
- **Adds** Row-Level Security so a delivery worker sees only their own collections, and only owners and managers can confirm handovers.
- It does **not** delete, edit or move any existing payment, invoice, order, ledger entry or account, and it does not touch your earlier migrations. This was checked by applying it to a copy of the demo database and comparing every payment, invoice, ledger line and balance before and after: they were identical.

### Run it

1. See what is applied (read-only):

   ```powershell
   npx supabase migration list
   ```

   You should see your 10 existing migrations in both the **Local** and **Remote** columns, and only `20261029000100` with an empty **Remote** column. If anything else looks different, stop and send me a screenshot.

2. Preview without changing anything:

   ```powershell
   npx supabase db push --dry-run
   ```

   It should say it would push only `20261029000100_delivery_cash_collections.sql`.

3. Apply it:

   ```powershell
   npx supabase db push
   ```

   Type `Y` and press Enter when asked. If it asks for a password, it is your Supabase **database** password (the one you used when you first linked the project). Wait for "Finished supabase db push".

If it fails, nothing from this migration is kept, and the app keeps working as before. Send me the error text (not your password or `.env.local`).

## 7. Start the app and check it

```powershell
npm run dev
```

- http://localhost:3000/api/health should still show `{"ok":true,"mode":"production"}`.
- As admin, **Admin → Health** should show **Migrations applied (11)**.
- As the wholesaler, the menu now has **Cash Collections** (under Delivery).
- As a delivery worker, the bottom bar now has **My cash**.

## 8. Your existing ₹300 payment (do this before recording Vikas's collections)

The ₹300 recorded on the Payments page for Ulgekar Shop is an **advance**: it counts as money received from the shop, but it is not applied to any invoice. Your two deliveries have no invoices yet (invoices are only made with **Generate GST invoice** on the order page; delivering does not make one), so the shop's balance is ₹0 invoiced − ₹300 received = **−₹300**, a credit in the shop's favour. The update does not change or move this payment. To confirm this from your own data, run the read-only queries in `docs/sql/check-manual-payments.sql` in the Supabase **SQL Editor**.

Decide which of these is true:

**A. The ₹300 is the cash Vikas collected on those two orders, and you already have it.**
1. Open each of the two orders and click **Generate GST invoice**.
2. Open the payment on the Payments page and use **Apply advance to**: ₹100 to the ₹200 order's invoice, ₹200 to the ₹300 order's invoice.
3. Do **not** let Vikas record those two collections again, or the shop would be credited twice.
Result: Ulgekar owes ₹200; nothing is pending with Vikas. (Cash Collections will list those two deliveries as "delivered with no payment recorded". That is expected, because the office recorded the money.)

**B. The ₹300 is Vikas's cash, but he still has it (it was recorded early by mistake).**
1. On the payment's page, **Reverse payment** with a reason such as "Re-recorded as delivery collections by Vikas". The record stays, marked reversed.
2. Vikas opens each delivery (**Completed** tab) and uses **Record the payment for this delivery**: ₹100 on the ₹200 order, ₹200 on the ₹300 order.
3. Generate both invoices; the collections are applied to them automatically.
4. When Vikas gives you the cash, use **Cash Collections → Receive cash from a worker**.
Result: Ulgekar owes ₹200; ₹300 pending with Vikas until you confirm the handover.

**C. The ₹300 is a separate advance from the shop.** Leave it. Have Vikas record what he actually collected on each delivery, generate the invoices, and apply the advance to invoices when the shop wants it used.

## 9. Try the new workflow

Delivery worker (phone):
1. **My deliveries** → open an order → **Start delivery**.
2. The card shows **Order total**, **Already paid** and **Due now**.
3. Enter the cash actually received (0 if nothing), check the "Shop will still owe" line, then **Delivered in full and save payment**.
4. A green box shows the receipt number (`RCPT-…`) and reference (`COL-…`).
5. **My cash** shows the cash still to hand over.

Owner or manager:
1. **Cash Collections**: choose the dates, see each worker's deliveries, cash collected, handed over and pending, and what shops still owe on those orders.
2. **Receive cash** next to the worker: count the cash, enter what you received, **Confirm cash received**. If it is short, the shortfall stays pending and is recorded.
3. **Handover history** lists every handover; open one to see or reverse it.

## If something goes wrong

Your old copy is in `C:\Users\Asus\Downloads\vyaporaflow-backup-2026-10-29`. The database migration only adds things, so the old app also keeps working with the migrated database.
