/**
 * Workflow B: retailer. Register, onboard, discover wholesalers, connect,
 * open a catalogue, add to cart, review the total, place the order and see
 * its status; then (as a retailer with billing history) view an invoice and
 * the payment history.
 */
import { expect, test } from "@playwright/test";
import { ANNAPURNA_ID, USERS, expectNoServerError, login, rupees, uid } from "./helpers";

test("workflow B1: a new retailer registers, onboards and places an order", async ({ page }) => {
  // 1. Register.
  const email = `e2e.${uid().toLowerCase()}@example.test`;
  await page.goto("/register?type=retailer");
  await page.getByLabel(/I run a shop/).check();
  await page.getByLabel("Your full name").fill("Test Shopkeeper");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Shop-test-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/onboarding/);

  // 2. Onboarding (shop in Kothrud, Pune, a PIN code Annapurna delivers to).
  await page.getByRole("link", { name: /shop|retailer/i }).first().click().catch(() => undefined);
  await page.getByLabel("Shop name").fill(`E2E Corner Store ${uid()}`);
  await page.getByLabel("Mobile number").fill("9000099999");
  await page.getByLabel("Shop or building, street").fill("Shop 1, Test Lane, Kothrud");
  await page.getByLabel("City").fill("Pune");
  await page.getByLabel("PIN code").fill("411038");
  await page.getByRole("button", { name: "Create my shop" }).click();
  await page.waitForURL(/\/r(\?|$)/);
  await expectNoServerError(page);

  // 3. Discover wholesalers near the shop (default 50 km radius).
  await page.goto("/r/discover");
  await expect(page.getByText(/wholesalers? within 50 km/)).toBeVisible();
  const card = page.locator("li, article").filter({ has: page.getByRole("link", { name: "Annapurna Kirana Wholesale" }) }).first();
  await expect(card).toBeVisible();
  await expect(page.getByText("Garden City Traders")).toHaveCount(0); // suspended company is hidden

  // Annapurna approves new retailers automatically.
  await card.getByRole("button", { name: "Ask to connect" }).click();
  await expect(card.getByRole("link", { name: "Order" })).toBeVisible();

  // 4. Open the wholesaler's catalogue.
  await card.getByRole("link", { name: "Order" }).click();
  await page.waitForURL(new RegExp(`/r/wholesalers/${ANNAPURNA_ID}`));

  // 5. Add products to the cart.
  const qty = page.locator('input[name="quantity"]');
  const adds = page.getByRole("button", { name: "Add", exact: true });
  for (const i of [0, 1]) {
    await qty.nth(i).fill("10");
    await adds.nth(0).click(); // the clicked button turns into "Update", so the next "Add" is index 0
    await expect(page.getByRole("button", { name: "Update" })).toHaveCount(i + 1);
  }

  // 6. Review the order total in the cart.
  await page.goto("/r/cart");
  const place = page.getByRole("button", { name: /Place order · ₹/ });
  await expect(place).toBeEnabled();
  const total = rupees((await place.textContent())!.split("·")[1]!);
  expect(total).toBeGreaterThanOrEqual(2000); // Annapurna's minimum order value

  // 7. Submit the order.
  await place.click();
  await page.waitForURL(/\/r\/orders\/[0-9a-f-]{36}\?placed=1/);

  // 8. Order status, with the same total the cart showed.
  await expect(page.getByText("Placed").first()).toBeVisible();
  await expect(page.getByText(new RegExp(`₹${total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`)).first()).toBeVisible();
  await page.goto("/r/orders");
  await expect(page.locator("tbody tr, li").filter({ hasText: "Annapurna" }).first()).toBeVisible();
});

test("workflow B2: a retailer views an invoice and payment history", async ({ page }) => {
  await login(page, USERS.retailer);
  // 9. Invoices.
  await page.goto("/r/invoices");
  const first = page.locator('td[data-label="Invoice"] a').first();
  const number = (await first.textContent())!.trim();
  await first.click();
  await expect(page.getByText(number).first()).toBeVisible();
  await expect(page.getByText(/Tax invoice|TAX INVOICE/).first()).toBeVisible();
  await expect(page.getByText(/HSN/).first()).toBeVisible();

  // 10. Payment history.
  await page.goto("/r/payments");
  await expect(page.locator('td[data-label="Wholesaler"]').first()).toBeVisible();
  await page.locator('td[data-label="Wholesaler"] a').first().click();
  await expect(page.getByText(/RCPT-\d{6}/).first()).toBeVisible();
  await expectNoServerError(page);

  // The logo goes to the home page, which offers a way back to the workspace.
  await page.goto("/r");
  await page.getByRole("link", { name: "VyaporaFlow home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Your wholesale business. Under control." })).toBeVisible();
  await page.getByRole("link", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/r(\?|$)/);
});
