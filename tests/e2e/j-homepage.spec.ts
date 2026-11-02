/**
 * Public homepage: loads without errors, every link on it works, screenshots
 * load, and the layout fits phones, tablets and desktops without sideways
 * scrolling.
 */
import { devices, expect, test, type Page } from "@playwright/test";

async function scrollThrough(page: Page) {
  // Images below the fold load lazily; scroll so every one is requested.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
}

test("homepage loads with the new sections and no console errors or redirects", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const res = await page.goto("/");
  expect(res!.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { level: 1, name: "One Platform. Three Partners. Smarter Business." })).toBeVisible();
  await expect(page.getByText("VyaporaFlow connects wholesalers, retailers and delivery partners through one intelligent business platform.")).toBeVisible();
  for (const h of [
    "Wholesale still runs on phone calls, notebooks and memory.",
    "Built for everyone who moves wholesale goods.",
    "Every part of the wholesale day, connected.",
    "From the shelf to the shop to the books.",
    "Every rupee accounted for, from invoice to handover.",
    "Each person sees only what their role needs.",
    "See VyaporaFlow at work.",
    "Frequently asked questions.",
    "Bring Your Wholesale Business Together.",
  ]) {
    await expect(page.getByRole("heading", { name: h })).toBeVisible();
  }
  await expect(page.locator("#features li")).toHaveCount(14);
  await expect(page.locator("#how-it-works ol > li")).toHaveCount(7);
  await scrollThrough(page);
  expect(errors).toEqual([]);
});

test("hero and call-to-action buttons go to the right places", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hero-get-started")).toHaveAttribute("href", "/register");
  await expect(page.getByTestId("hero-marketplace")).toHaveAttribute("href", "/marketplace");
  await expect(page.getByTestId("cta-start")).toHaveAttribute("href", "/register?type=wholesaler");
  await expect(page.getByTestId("cta-marketplace")).toHaveAttribute("href", "/marketplace");

  await page.getByTestId("hero-features").click();
  await expect(page).toHaveURL(/#features$/);
  await expect(page.locator("#features")).toBeInViewport();

  await page.getByTestId("hero-get-started").click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();

  await page.goto("/");
  await page.getByTestId("cta-start").click();
  await expect(page).toHaveURL(/\/register\?type=wholesaler$/);

  await page.goto("/");
  await page.getByTestId("hero-marketplace").click();
  await expect(page).toHaveURL(/\/marketplace$/);
});

test("every link on the homepage works and the footer has the required links", async ({ page, request }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  for (const name of ["Features", "Pricing", "How It Works", "For Wholesalers", "For Retailers", "Marketplace", "Contact", "Privacy Policy", "Terms"]) {
    await expect(footer.getByRole("link", { name, exact: true })).toBeVisible();
  }
  const hrefs = await page.$$eval("a[href]", (as) => [...new Set(as.map((a) => a.getAttribute("href")!))]);
  const internal = hrefs.filter((h) => h.startsWith("/"));
  expect(internal.length).toBeGreaterThan(10);
  for (const h of internal) {
    const r = await request.get(h, { maxRedirects: 0 });
    expect(r.status(), `link ${h}`).toBe(200);
  }
  for (const h of hrefs.filter((x) => x.startsWith("#"))) {
    expect(await page.locator(h).count(), `anchor ${h}`).toBe(1);
  }
  // FAQ answers open.
  await page.getByText("Does WhatsApp send messages automatically?").click();
  await expect(page.getByText("No. VyaporaFlow opens WhatsApp with the right contact and a prepared message.")).toBeVisible();
});

test("all screenshots load", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); // floating hero images stand still
  await page.goto("/");
  await scrollThrough(page);
  const imgs = page.locator("main img:visible");
  const n = await imgs.count();
  expect(n).toBeGreaterThanOrEqual(10);
  for (let i = 0; i < n; i++) {
    const img = imgs.nth(i);
    await img.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { message: `image ${i}` }).toBe(true);
    expect(await img.getAttribute("alt")).toBeTruthy();
  }
});

for (const [name, device] of [
  ["phone", devices["Pixel 7"]],
  ["small phone", { ...devices["iPhone SE"], defaultBrowserType: "chromium" as const }],
  ["tablet", { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
] as const) {
  test(`no horizontal overflow on a ${name}`, async ({ browser }) => {
    const { defaultBrowserType: _ignored, ...opts } = device as typeof device & { defaultBrowserType?: string };
    const context = await browser.newContext({ ...opts, baseURL: test.info().project.use.baseURL });
    const page = await context.newPage();
    await page.goto("/");
    await scrollThrough(page);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
    // The mobile menu still opens and lists the main pages.
    await page.getByText("Menu", { exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Main (mobile)" }).getByRole("link", { name: "Marketplace" })).toBeVisible();
    await context.close();
  });
}
