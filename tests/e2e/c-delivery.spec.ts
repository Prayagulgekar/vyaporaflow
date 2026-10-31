/**
 * Workflow C: delivery worker on a phone-sized screen. View assigned
 * deliveries, open one, start it, complete it and check the recorded history.
 */
import { expect, test } from "@playwright/test";
import { USERS, expectNoServerError, login, placeRetailerOrder, readyAndAssign } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("workflow C: delivery worker completes an assigned delivery", async ({ page, browser }) => {
  // Arrange: a fresh order assigned to Ravi (retailer orders, wholesaler assigns).
  const { orderId, orderNumber } = await placeRetailerOrder(browser, { search: "Crispo Classic", unit: "carton", qty: "2" });
  await readyAndAssign(browser, orderId, "Ravi");
  // 1-2. Log in and view assigned deliveries.
  await login(page, USERS.delivery);
  await expect(page).toHaveURL(/\/d(\?|$)/);
  await expect(page.getByRole("heading", { name: "My deliveries" })).toBeVisible();
  const cards = page.locator('main a[href^="/d/"]');
  await expect(cards.first()).toBeVisible();

  // 3. Open the delivery for that order.
  const target = cards.filter({ hasText: orderNumber }).first();
  const href = (await target.getAttribute("href"))!;
  await target.click();
  await page.waitForURL(new RegExp(`${href}$`));

  // 4. Update the status: start the delivery.
  await page.getByRole("button", { name: "Start delivery" }).click();
  await expect(page.getByText(/Out for delivery/).first()).toBeVisible();

  // 5. Complete the delivery.
  await page.getByLabel("Received by").first().fill("Shop owner (E2E)");
  const empties = page.getByLabel("Empty cylinders collected");
  if (await empties.count()) await empties.first().fill("1");
  await page.getByLabel(/Amount collected now/).first().fill("0");
  await page.getByRole("button", { name: "Delivered in full" }).click();
  await expect(page.getByText("Saved: nothing collected")).toBeVisible();
  await expect(page.getByText(/^Delivered$/).first()).toBeVisible();

  // 6. The recorded history shows each step with the worker's name.
  const history = page.locator("section").filter({ has: page.getByRole("heading", { name: "History" }) });
  await expect(history).toContainText(/Out for delivery/i);
  await expect(history).toContainText(/Delivered/i);
  await expect(history).toContainText(/Ravi/);

  // The delivery moved to the completed list and is no longer editable.
  await page.goto("/d?scope=completed");
  await expect(page.locator(`a[href="${href}"]`)).toBeVisible();
  await page.goto(href);
  await expect(page.getByRole("button", { name: "Delivered in full" })).toHaveCount(0);
  await expectNoServerError(page);
});
