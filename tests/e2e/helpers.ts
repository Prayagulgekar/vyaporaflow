import { expect, type Browser, type Page } from "@playwright/test";

/** Demo-only password from supabase/seed.sql. Never valid outside demo mode. */
export const DEMO_PASSWORD = "VyaporaDemo#2026";

export const USERS = {
  wholesaler: "sahyadri.owner@vyaporaflow.test",
  otherWholesaler: "annapurna.owner@vyaporaflow.test",
  retailer: "ganesh.retailer@vyaporaflow.test",
  otherRetailer: "omsai.retailer@vyaporaflow.test",
  pendingRetailer: "laxmi.retailer@vyaporaflow.test",
  delivery: "ravi.delivery@vyaporaflow.test",
  otherDelivery: "sunil.delivery@vyaporaflow.test",
} as const;

export const SAHYADRI_ID = "10000000-0000-4000-8000-000000000001";
export const ANNAPURNA_ID = "10000000-0000-4000-8000-000000000002";

export async function login(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}

/** Parse "₹1,23,456.78" (or a plain number) into a number of rupees. */
export function rupees(text: string): number {
  const m = text.replace(/[,\s]/g, "").match(/-?₹?(-?\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`No amount in "${text}"`);
  return Number(m[1]);
}

export async function expectNoServerError(page: Page) {
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
}

export const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

/** As Shree Ganesh (in a separate session), order `qty` of the first catalogue match from a wholesaler. */
export async function placeRetailerOrder(browser: Browser, opts: { wholesalerId?: string; search: string; qty: string; unit?: string; retailer?: string }) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, opts.retailer ?? USERS.retailer);
  await p.goto(`/r/wholesalers/${opts.wholesalerId ?? SAHYADRI_ID}?q=${encodeURIComponent(opts.search)}`);
  const input = opts.unit ? p.getByLabel(new RegExp(`in ${opts.unit}$`)).first() : p.locator('input[name="quantity"]').first();
  const form = p.locator("form").filter({ has: input });
  await input.fill(opts.qty);
  await form.getByRole("button", { name: /^(Add|Update)$/ }).click();
  await expect(form.getByRole("button", { name: "Update" })).toBeVisible();
  await p.goto("/r/cart");
  await p.getByRole("button", { name: /Place order/ }).first().click();
  await p.waitForURL(/\/r\/orders\/[0-9a-f-]{36}\?placed=1/);
  const orderId = new URL(p.url()).pathname.split("/").pop()!;
  const orderNumber = (await p.getByRole("heading", { level: 1 }).textContent())!.match(/[A-Z]+-[A-Z0-9/-]+\d/)![0];
  await ctx.close();
  return { orderId, orderNumber };
}

/** As the Sahyadri owner, accept, prepare, mark ready and assign the order to a worker. */
export async function readyAndAssign(browser: Browser, orderId: string, workerName = "Ravi") {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, USERS.wholesaler);
  await p.goto(`/w/orders/${orderId}`);
  for (const label of ["Accept order", "Start preparing", "Mark ready for delivery"]) {
    await p.getByRole("button", { name: label }).click();
    await expect(p.getByRole("button", { name: label })).toHaveCount(0);
  }
  const sel = p.getByLabel("Delivered by");
  await sel.selectOption((await sel.locator("option", { hasText: workerName }).getAttribute("value"))!);
  await p.getByRole("button", { name: "Assign" }).click();
  await expect(p.getByText(new RegExp(workerName)).first()).toBeVisible();
  await ctx.close();
}
