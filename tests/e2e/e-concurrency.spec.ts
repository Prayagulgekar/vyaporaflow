/**
 * Workflow E: concurrency through the running app. Simultaneous orders for
 * the last stock, duplicate order submissions and a double-submitted payment.
 * (PGlite in demo mode serializes transactions; true parallel transactions are
 * covered on PostgreSQL by tests/integration/concurrency.test.ts.)
 */
import { expect, test, type Page } from "@playwright/test";
import { SAHYADRI_ID, USERS, login, rupees, uid } from "./helpers";

const GANESH_ID = "20000000-0000-4000-8000-000000000001";
const OMSAI_ID = "20000000-0000-4000-8000-000000000002";

async function createScarceProduct(page: Page, stock: string) {
  const sku = `E2E-LAST-${uid()}`;
  await page.goto("/w/products/new");
  await page.getByLabel("Product name").fill(`E2E Gift Hamper ${sku}`);
  await page.getByLabel("Category").selectOption({ label: "Biscuits" });
  await page.locator('[name="variant.name"]').fill("1 hamper");
  await page.locator('[name="variant.sku"]').fill(sku);
  await page.locator('[name="variant.opening_stock"]').fill(stock);
  await page.locator('input[name="units.0.price"]').fill("1500");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL(/\/w\/products\/[0-9a-f-]{36}/);
  return sku;
}

test("concurrent orders for the last units cannot oversell; duplicate submissions are idempotent", async ({ browser }) => {
  const w = await browser.newContext();
  const wp = await w.newPage();
  await login(wp, USERS.wholesaler);
  const sku = await createScarceProduct(wp, "3");

  const shops = await Promise.all(
    [USERS.retailer, USERS.otherRetailer].map(async (email) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await login(page, email);
      return { ctx, page };
    }),
  );
  const g = shops[0]!.page;
  await g.goto(`/r/wholesalers/${SAHYADRI_ID}?q=${sku}`);
  const unitId = (await g.locator('input[name="variant_unit_id"]').first().getAttribute("value"))!;
  const origin = new URL(g.url()).origin;

  // Eight simultaneous single-unit orders from two shops for three units of stock.
  const attempts = Array.from({ length: 8 }, (_, i) => {
    const { page } = shops[i % 2]!;
    return page.request.post("/api/v1/orders", {
      headers: { Origin: origin },
      data: { retailer_id: i % 2 ? OMSAI_ID : GANESH_ID, wholesaler_id: SAHYADRI_ID, items: [{ variant_unit_id: unitId, quantity: "1" }], idempotency_key: `e2e-race-${uid()}-${i}` },
    });
  });
  const statuses = (await Promise.all(attempts)).map((r) => r.status());
  expect(statuses.filter((s) => s === 201)).toHaveLength(3);
  expect(statuses.filter((s) => s !== 201).every((s) => s === 422 || s === 409)).toBe(true);

  // Stock shows 3 reserved and 0 available.
  await wp.goto(`/w/inventory?q=${sku}`);
  const row = wp.getByRole("row").filter({ hasText: sku }).first();
  await expect(row.locator('td[data-label="On hand"]')).toHaveText(/^3 /);
  await expect(row.locator('td[data-label="Reserved"]')).toHaveText(/^3 /);
  await expect(row.locator('td[data-label="Available"]')).toContainText(/^0 /);

  // Duplicate submissions with one idempotency key give one order.
  const sku2 = await createScarceProduct(wp, "10");
  await g.goto(`/r/wholesalers/${SAHYADRI_ID}?q=${sku2}`);
  const unit2 = (await g.locator('input[name="variant_unit_id"]').first().getAttribute("value"))!;
  const key = `e2e-dup-${uid()}`;
  const dupes = await Promise.all(
    Array.from({ length: 5 }, () =>
      g.request.post("/api/v1/orders", {
        headers: { Origin: origin },
        data: { retailer_id: GANESH_ID, wholesaler_id: SAHYADRI_ID, items: [{ variant_unit_id: unit2, quantity: "2" }], idempotency_key: key },
      }),
    ),
  );
  const ids = new Set(await Promise.all(dupes.map(async (r) => (await r.json()).id)));
  expect(dupes.every((r) => r.status() === 201)).toBe(true);
  expect(ids.size).toBe(1);

  for (const s of shops) await s.ctx.close();
  await w.close();
});

test("a double-submitted payment form records one payment", async ({ page }) => {
  await login(page, USERS.wholesaler);
  await page.goto(`/w/balances?filter=all`);
  const balRow = page.locator("tbody tr").filter({ has: page.locator(`a[href="/w/retailers/${GANESH_ID}"]`) });
  const before = rupees((await balRow.locator('td[data-label="Outstanding"]').textContent())!);

  await page.goto(`/w/payments/new?retailer=${GANESH_ID}`);
  await page.getByLabel("Amount received (₹)").fill("123");
  await page.getByLabel("Reference").fill(`DOUBLE-${uid()}`);
  // Submit the same form twice in the same tick, as a double tap would.
  await page.locator("form").filter({ has: page.getByRole("button", { name: "Record payment" }) }).evaluate((f) => {
    (f as HTMLFormElement).requestSubmit();
    (f as HTMLFormElement).requestSubmit();
  });
  await page.waitForURL(/\/w\/payments\/[0-9a-f-]{36}/);

  await page.goto(`/w/balances?filter=all`);
  const after = rupees((await balRow.locator('td[data-label="Outstanding"]').textContent())!);
  expect(Math.round((before - after) * 100)).toBe(12300);
});
