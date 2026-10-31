/**
 * Workflow H: delivery cash collection and handover.
 * Ravi delivers on a phone, collects part of the order in cash and gets a
 * receipt; the owner sees the cash pending, receives less than expected, and
 * the shortfall stays pending. Another worker cannot open Ravi's delivery.
 */
import { expect, test } from "@playwright/test";
import { USERS, expectNoServerError, login, placeRetailerOrder, readyAndAssign, rupees } from "./helpers";

test("workflow H: partial cash on delivery, then a short handover", async ({ browser }) => {
  const { orderId, orderNumber } = await placeRetailerOrder(browser, { search: "Crispo Classic", unit: "carton", qty: "2" });
  await readyAndAssign(browser, orderId, "Ravi");

  // Worker, phone-sized.
  const wctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const wp = await wctx.newPage();
  await login(wp, USERS.delivery);
  await wp.getByRole("link", { name: new RegExp(orderNumber.replace(/[/]/g, "\\/")) }).first().click();
  await wp.waitForURL(/\/d\/[0-9a-f-]{36}$/);
  const deliveryUrl = wp.url();
  await wp.getByRole("button", { name: "Start delivery" }).click();

  // Before submitting: order total, already paid and due now are shown.
  const summary = wp.locator("dl").filter({ hasText: "Due now" }).first();
  await expect(summary).toContainText("Order total");
  const due = rupees((await summary.locator("dd").nth(2).textContent())!);
  expect(due).toBeGreaterThan(100);

  // More than is due is refused by the server, and the typed values stay.
  const amount = wp.getByLabel(/Amount collected now/).first();
  await amount.fill(String(due + 1));
  await expect(wp.getByText(/is due on this order/).first()).toBeVisible();
  await wp.getByRole("button", { name: "Delivered in full" }).click();
  await expect(wp.getByText(/Only Rs .* is due/)).toBeVisible();
  await expect(amount).toHaveValue(String(due + 1));
  await expect(wp.getByRole("button", { name: "Delivered in full" })).toBeVisible();

  // ₹100 in cash: live preview, then a receipt.
  await amount.fill("100");
  await expect(wp.getByText(/Shop will still owe/).first()).toBeVisible();
  await wp.getByRole("button", { name: "Delivered in full" }).click();
  await expect(wp.getByText("Saved: ₹100.00 in cash")).toBeVisible();
  await expect(wp.getByText(/Receipt RCPT-\d{6}/)).toBeVisible();
  await expect(wp.getByText(/COL-\d{6}/).first()).toBeVisible();
  const owes = wp.getByRole("status").filter({ hasText: "Shop still owes" });
  expect(rupees((await owes.textContent())!.split("Shop still owes")[1]!)).toBeCloseTo(due - 100, 2);

  // My cash: the ₹100 is with the worker.
  await wp.goto("/d/cash");
  await expect(wp.getByText("Cash with you (to hand over)").locator("..")).toContainText("₹100.00");
  await expectNoServerError(wp);
  await wctx.close();

  // Another worker cannot open it.
  const octx = await browser.newContext();
  const op = await octx.newPage();
  await login(op, USERS.otherDelivery);
  const res = await op.goto(deliveryUrl);
  expect(res?.status()).toBe(404);
  await octx.close();

  // Owner: Cash Collections shows the cash pending, separate from what the shop owes.
  const octx2 = await browser.newContext();
  const page = await octx2.newPage();
  await login(page, USERS.wholesaler);
  await page.goto("/w/cash-collections");
  const row = page.locator("tbody tr").filter({ hasText: "Ravi" }).first();
  await expect(row.locator('td[data-label="Cash collected"]')).toContainText("₹100.00");
  await expect(row.locator('td[data-label="Pending handover"]')).toContainText("₹100.00");
  await expect(page.getByText(orderNumber).first()).toBeVisible();

  // The payment is on the Payments screen once, tagged as collected on delivery.
  await page.goto("/w/payments");
  await expect(page.getByText(/Collected on delivery by Ravi/).first()).toBeVisible();

  // Receive ₹60 of the ₹100: ₹40 short stays pending.
  await page.goto("/w/cash-collections");
  await row.getByRole("link", { name: "Receive cash" }).click();
  await expect(page.getByText("Expected cash from")).toBeVisible();
  await page.getByLabel(/Cash you actually received/).fill("60");
  await expect(page.getByText(/Short by/)).toContainText("₹40.00");
  await page.getByRole("button", { name: "Confirm cash received" }).click();
  await page.waitForURL(/\/w\/cash-collections\/handovers\/[0-9a-f-]{36}\?saved=1/);
  await expect(page.getByText(/HO-\d{6} confirmed/)).toBeVisible();
  await expect(page.getByText(/₹40.00 is short/)).toBeVisible();

  await page.goto("/w/cash-collections");
  await expect(page.locator("tbody tr").filter({ hasText: "Ravi" }).first().locator('td[data-label="Pending handover"]')).toContainText("₹40.00");
  await expectNoServerError(page);
  await octx2.close();
});
