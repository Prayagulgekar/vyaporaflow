/**
 * Workflow A: wholesaler. Log in, open the dashboard, create a product with a
 * price and stock, accept and prepare a retailer order, assign delivery,
 * generate the invoice, record a payment and check the resulting balance.
 */
import { expect, test } from "@playwright/test";
import { SAHYADRI_ID, USERS, expectNoServerError, login, rupees, uid } from "./helpers";

test("workflow A: wholesaler runs an order from acceptance to payment", async ({ page, browser }) => {
  // 1-2. Log in and open the dashboard.
  await login(page, USERS.wholesaler);
  await expect(page).toHaveURL(/\/w(\?|$)/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoServerError(page);

  // 3-5. Create a product with a price and opening stock.
  const sku = `E2E-${uid()}`;
  const name = `E2E Glucose Biscuits ${sku}`;
  await page.goto("/w/products/new");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Category").selectOption({ label: "Biscuits" });
  await page.getByLabel("GST rate").selectOption({ index: 2 });
  await page.getByLabel("HSN code").fill("1905");
  await page.locator('[name="variant.name"]').fill("100 g");
  await page.locator('[name="variant.sku"]').fill(sku);
  await page.locator('[name="variant.opening_stock"]').fill("240");
  await page.locator('input[name="units.0.price"]').fill("9.50");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL(/\/w\/products\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.goto(`/w/inventory?q=${sku}`);
  const invRow = page.getByRole("row").filter({ hasText: sku }).first();
  await expect(invRow).toContainText("240");

  // A retailer (in their own session) orders the new product, so the test
  // does not depend on which seeded orders are still open.
  const shop = await browser.newContext();
  const rp = await shop.newPage();
  await login(rp, USERS.retailer);
  await rp.goto(`/r/wholesalers/${SAHYADRI_ID}?q=${sku}`);
  await rp.getByLabel(new RegExp(`Quantity of .*${sku}|Quantity of ${name}`)).first().fill("150");
  await rp.getByRole("button", { name: "Add" }).first().click();
  await expect(rp.getByRole("button", { name: "Update" }).first()).toBeVisible();
  await rp.goto("/r/cart");
  await rp.getByRole("button", { name: /Place order/ }).first().click();
  await rp.waitForURL(/\/r\/orders\/[0-9a-f-]{36}\?placed=1/);
  const orderNumber = (await rp.getByRole("heading", { level: 1 }).textContent())!.match(/[A-Z]+-[A-Z0-9/-]+\d/)![0];
  await shop.close();

  // 6. Order management screen: find the new order among placed orders.
  await page.goto("/w/orders?status=placed");
  await page.getByRole("link", { name: orderNumber, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(orderNumber);

  // 7-8. Accept, prepare, mark ready.
  await page.getByRole("button", { name: "Accept order" }).click();
  await expect(page.getByRole("button", { name: "Start preparing" })).toBeVisible();
  await page.getByRole("button", { name: "Start preparing" }).click();
  await expect(page.getByRole("button", { name: "Mark ready for delivery" })).toBeVisible();
  await page.getByRole("button", { name: "Mark ready for delivery" }).click();
  await expect(page.getByText("Ready for delivery").first()).toBeVisible();

  // 9. Assign a delivery worker.
  const workerSelect = page.getByLabel("Delivered by");
  const raviValue = await workerSelect.locator("option", { hasText: "Ravi" }).getAttribute("value");
  await workerSelect.selectOption(raviValue!);
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText(/Ravi Gaikwad/).first()).toBeVisible();

  // The invoice uses delivered quantities, so the assigned worker delivers first
  // (in their own browser session; workflow C covers the worker's screens in detail).
  const orderUrl = page.url();
  const worker = await browser.newContext();
  const wp = await worker.newPage();
  await login(wp, USERS.delivery);
  await wp.getByRole("link", { name: new RegExp(orderNumber.replace(/[/]/g, "\\/")) }).first().click();
  await wp.getByRole("button", { name: "Start delivery" }).click();
  // Nothing collected on delivery: the office records the ₹500 payment below.
  await wp.getByLabel(/Amount collected now/).first().fill("0");
  await wp.getByRole("button", { name: "Delivered in full" }).click();
  await expect(wp.getByText("Saved: nothing collected")).toBeVisible();
  await worker.close();
  await page.goto(orderUrl);

  // 10. Generate the GST invoice.
  await page.getByRole("button", { name: "Generate GST invoice" }).click();
  await page.waitForURL(/\/w\/billing\/[0-9a-f-]{36}/);
  await expect(page.getByText(/INV\/\d{2}-\d{2}\/\d{5}/).first()).toBeVisible();
  await expect(page.getByText(/CGST/).first()).toBeVisible();
  const retailerLink = page.getByRole("link", { name: "Record payment" });
  const retailerId = new URL((await retailerLink.getAttribute("href"))!, "http://x").searchParams.get("retailer")!;

  // Balance before payment.
  await page.goto(`/w/balances?filter=all`);
  const balRow = page.locator("tbody tr").filter({ has: page.locator(`a[href="/w/retailers/${retailerId}"]`) });
  const before = rupees((await balRow.locator('td[data-label="Outstanding"]').textContent())!);
  expect(before).toBeGreaterThan(0);

  // 11. Record a payment.
  await page.goto(`/w/payments/new?retailer=${retailerId}`);
  await page.getByLabel("Amount received (₹)").fill("500");
  await page.getByLabel("Reference").fill(`UPI-${uid()}`);
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.waitForURL(/\/w\/payments\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 1, name: /Payment RCPT-\d{6}/ })).toBeVisible();

  // 12. The outstanding balance fell by exactly the payment.
  await page.goto(`/w/balances?filter=all`);
  const after = rupees((await balRow.locator('td[data-label="Outstanding"]').textContent())!);
  expect(Math.round((before - after) * 100)).toBe(50000);
  await expectNoServerError(page);
});
