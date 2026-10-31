/**
 * Workflow D: security. Each attempt goes through the running app (pages,
 * server actions with tampered form fields, or the JSON API) and must be
 * rejected. The database-level equivalents are in tests/integration/rls.test.ts.
 */
import { expect, test, type Page } from "@playwright/test";
import { SAHYADRI_ID, USERS, login, placeRetailerOrder, readyAndAssign, uid } from "./helpers";

const GANESH_ID = "20000000-0000-4000-8000-000000000001";
const origin = (page: Page) => new URL(page.url()).origin;

async function firstIdFrom(page: Page, path: string, linkPrefix: string) {
  await page.goto(path);
  const hrefs = await page.locator(`a[href^="${linkPrefix}"]`).evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  const id = hrefs.map((h) => h.slice(linkPrefix.length).split(/[?#/]/)[0]!).find((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!id) throw new Error(`No record link under ${path}`);
  return id;
}

test("1. another company's private records are not reachable", async ({ browser }) => {
  const a = await browser.newContext();
  const ap = await a.newPage();
  await login(ap, USERS.wholesaler);
  const sahyadriOrder = await firstIdFrom(ap, "/w/orders", "/w/orders/");
  const sahyadriProduct = await firstIdFrom(ap, "/w/products", "/w/products/");
  await a.close();

  const r = await browser.newContext();
  const rp = await r.newPage();
  await login(rp, USERS.retailer);
  const ganeshInvoice = await firstIdFrom(rp, "/r/invoices", "/r/invoices/");
  await r.close();

  const b = await browser.newContext();
  const bp = await b.newPage();
  await login(bp, USERS.otherWholesaler);
  for (const path of [`/w/orders/${sahyadriOrder}`, `/w/products/${sahyadriProduct}`]) {
    const res = await bp.goto(path);
    expect(res!.status(), path).toBe(404);
  }
  const api = await bp.request.get(`/api/v1/orders/${sahyadriOrder}`);
  expect(api.status()).toBe(404);
  await b.close();

  const o = await browser.newContext();
  const op = await o.newPage();
  await login(op, USERS.otherRetailer);
  expect((await op.goto(`/r/invoices/${ganeshInvoice}`))!.status()).toBe(404);
  expect((await op.request.get(`/api/v1/orders/${sahyadriOrder}`)).status()).toBe(404);
  await o.close();

  // Signed-out visitors are sent to the login page.
  const anon = await browser.newContext();
  const np = await anon.newPage();
  await np.goto(`/w/orders/${sahyadriOrder}`);
  await expect(np).toHaveURL(/\/login/);
  expect((await np.request.get(`/api/v1/orders/${sahyadriOrder}`)).status()).toBe(401);
  await anon.close();
});

test("2. unauthorized orders are refused", async ({ page }) => {
  // A retailer whose connection is still pending cannot order from a wholesaler that requires approval.
  await login(page, USERS.retailer);
  await page.goto(`/r/wholesalers/${SAHYADRI_ID}?q=Crispo`);
  const unitId = (await page.locator('input[name="variant_unit_id"]').first().getAttribute("value"))!;

  await page.context().clearCookies();
  await login(page, USERS.pendingRetailer);
  const laxmi = await (await page.request.get("/api/v1/me")).json();
  const laxmiId = laxmi.memberships.find((m: { kind: string }) => m.kind === "retailer").companyId;
  const pending = await page.request.post("/api/v1/orders", {
    headers: { Origin: origin(page) },
    data: { retailer_id: laxmiId, wholesaler_id: SAHYADRI_ID, items: [{ variant_unit_id: unitId, quantity: "2" }], idempotency_key: `e2e-${uid()}-pending` },
  });
  expect([403, 422]).toContain(pending.status());
  expect((await pending.json()).error).toMatch(/approv|connect|permission/i);

  // A retailer cannot order on behalf of another shop by changing the retailer ID.
  {
    const forged = await page.request.post("/api/v1/orders", {
      headers: { Origin: origin(page) },
      data: { retailer_id: GANESH_ID, wholesaler_id: SAHYADRI_ID, items: [{ variant_unit_id: unitId, quantity: "2" }], idempotency_key: `e2e-${uid()}-forged` },
    });
    expect([403, 404, 422]).toContain(forged.status());
  }

  // Cross-site requests are refused even with a valid session cookie.
  const csrf = await page.request.post("/api/v1/orders", { headers: { Origin: "https://attacker.example" }, data: {} });
  expect(csrf.status()).toBe(403);
});

test("3. a delivery worker cannot update a delivery assigned to someone else", async ({ page, browser }) => {
  const forRavi = await placeRetailerOrder(browser, { search: "Crispo Classic", unit: "carton", qty: "2" });
  await readyAndAssign(browser, forRavi.orderId, "Ravi");
  const forSunil = await placeRetailerOrder(browser, { search: "Crispo Classic", unit: "carton", qty: "3" });
  await readyAndAssign(browser, forSunil.orderId, "Sunil");

  const rc = await browser.newContext();
  const rp = await rc.newPage();
  await login(rp, USERS.delivery);
  const raviHref = (await rp.locator('a[href^="/d/"]').filter({ hasText: forRavi.orderNumber }).first().getAttribute("href"))!;
  await rc.close();

  await login(page, USERS.otherDelivery);
  // Sunil cannot open Ravi's delivery.
  expect((await page.goto(raviHref))!.status()).toBe(404);

  // Sunil tampers with his own delivery form so it targets Ravi's delivery.
  await page.goto("/d");
  await page.locator('a[href^="/d/"]').filter({ hasText: forSunil.orderNumber }).first().click();
  const raviDeliveryId = raviHref.split("/").pop()!;
  await page.locator('input[name="delivery_id"]').first().evaluate((el, id) => ((el as HTMLInputElement).value = id), raviDeliveryId);
  await page.getByRole("button", { name: "Start delivery" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /not assigned|not found|permission/i }).first()).toBeVisible();

  // Ravi's delivery is unchanged.
  const rc2 = await browser.newContext();
  const rp2 = await rc2.newPage();
  await login(rp2, USERS.delivery);
  await rp2.goto(raviHref);
  await expect(rp2.getByRole("button", { name: "Start delivery" })).toBeVisible();
  await rc2.close();
});

test("4. order totals cannot be set or changed by the client", async ({ page }) => {
  await login(page, USERS.retailer);
  await page.goto(`/r/wholesalers/${SAHYADRI_ID}?q=Crispo Classic`);
  const unit = page.getByLabel(/in carton$/).first().locator("xpath=ancestor::form[1]").locator('input[name="variant_unit_id"]');
  const unitId = (await unit.getAttribute("value"))!;

  const res = await page.request.post("/api/v1/orders", {
    headers: { Origin: origin(page) },
    data: {
      retailer_id: GANESH_ID,
      wholesaler_id: SAHYADRI_ID,
      items: [{ variant_unit_id: unitId, quantity: "2", unit_price: "0.01", line_total: "0.02" }],
      grand_total: "1.00",
      subtotal: "1.00",
      idempotency_key: `e2e-${uid()}-total`,
    },
  });
  expect(res.status()).toBe(201);
  const order = await res.json();
  expect(Number(order.grand_total)).toBeGreaterThan(1000); // priced by the database, not the client

  // There is no API to edit a placed order.
  for (const method of ["PUT", "PATCH", "DELETE"] as const) {
    const r = await page.request.fetch(`/api/v1/orders/${order.id}`, { method, headers: { Origin: origin(page) }, data: { grand_total: "1.00" } });
    expect(r.status(), method).toBe(405);
  }
  const again = await (await page.request.get(`/api/v1/orders/${order.id}`)).json();
  expect(again.grand_total).toBe(order.grand_total);
});

test("5. nobody can make themselves a platform administrator", async ({ page }) => {
  // The registration form offers no admin option; a tampered value is rejected.
  await page.goto("/register");
  await expect(page.getByLabel(/admin/i)).toHaveCount(0);
  await page.locator('input[name="account_type"]').first().evaluate((el) => ((el as HTMLInputElement).value = "admin"));
  await page.locator('input[name="account_type"]').first().check();
  await page.getByLabel("Your full name").fill("Sneaky Person");
  await page.getByLabel("Email").fill(`sneaky.${uid().toLowerCase()}@example.test`);
  await page.getByLabel("Password").fill("Sneaky-pass-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/register/);
  await expect(page.getByText(/choose|select|invalid/i).first()).toBeVisible();

  // A signed-in business owner cannot open the admin console.
  await login(page, USERS.wholesaler);
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin/);
  const me = await (await page.request.get("/api/v1/me")).json();
  expect(me.isAdmin).toBe(false);
});
