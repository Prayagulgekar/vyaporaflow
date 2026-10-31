/**
 * Captures the marketing screenshots in public/screenshots from a running demo
 * server, so the marketing site only ever shows the real application.
 *
 *   npm run dev            # in one terminal (demo mode, seeded data)
 *   npm run screenshots    # in another; BASE_URL defaults to http://localhost:3000
 */
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "public/screenshots";
const PASSWORD = "VyaporaDemo#2026";

async function signIn(browser: Browser, email: string, mobile: boolean): Promise<Page> {
  const ctx = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 },
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  return page;
}

async function shot(page: Page, path: string, name: string, prepare?: (p: Page) => Promise<void>) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (prepare) await prepare(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`saved ${OUT}/${name}.png  (${path})`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const w = await signIn(browser, "sahyadri.owner@vyaporaflow.test", false);
    await shot(w, "/w?period=30d", "wholesaler-overview");
    await shot(w, "/w/orders", "wholesaler-orders");
    await shot(w, "/w/products", "wholesaler-products");
    await shot(w, "/w/inventory", "wholesaler-inventory");
    await shot(w, "/w/retailers/20000000-0000-4000-8000-000000000001", "wholesaler-statement");
    await shot(w, "/marketplace?pincode=411038&radius=25", "marketplace");

    const r = await signIn(browser, "ganesh.retailer@vyaporaflow.test", true);
    await shot(r, "/r", "retailer-home-mobile");
    await shot(r, "/r/wholesalers/10000000-0000-4000-8000-000000000001", "retailer-catalog-mobile");
    await shot(r, "/r/cart", "retailer-cart-mobile");

    const d = await signIn(browser, "ravi.delivery@vyaporaflow.test", true);
    await shot(d, "/d", "delivery-mobile");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
