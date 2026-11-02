/**
 * WhatsApp messages, PDF documents and WhatsApp document sharing.
 *
 * WhatsApp itself is stubbed (wa.me, web.whatsapp.com, api.whatsapp.com), so
 * nothing ever leaves the machine. On a computer WhatsApp Web opens with the
 * chat and message; on a phone that can share files the PDF goes to the share
 * sheet (simulated here, since a headless browser has no share sheet).
 */
import { readFileSync } from "node:fs";
import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { USERS, expectNoServerError, login } from "./helpers";

const GANESH_ID = "20000000-0000-4000-8000-000000000001";
const LAXMI_ID = "20000000-0000-4000-8000-000000000003";

async function stubWhatsApp(context: BrowserContext) {
  await context.route(/^https:\/\/(wa\.me|web\.whatsapp\.com|api\.whatsapp\.com)\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>WhatsApp stub</title>" }),
  );
}

async function desktop(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: test.info().project.use.baseURL, locale: "en-IN", timezoneId: "Asia/Kolkata", acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubWhatsApp(context);
  return context;
}

async function expectPdfDownload(page: Page, trigger: () => Promise<unknown>, name: RegExp) {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  expect(download.suggestedFilename()).toMatch(name);
  const path = await download.path();
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(5000);
  return download.suggestedFilename();
}

test("retailer profile: WhatsApp composer prepares the balance reminder with the real figures", async ({ browser }) => {
  const context = await desktop(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await login(page, USERS.wholesaler);
  await page.goto(`/w/retailers/${GANESH_ID}`);
  const stat = page.locator("div.card").filter({ has: page.getByText("Outstanding", { exact: true }) }).first();
  const outstanding = (await stat.textContent())!.match(/-?₹[\d,]+\.\d{2}/)![0];

  await page.getByTestId("whatsapp-composer").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("whatsapp-recipient")).toHaveText("To +91 90000 01001");
  await dialog.getByTestId("whatsapp-template").selectOption("balance");
  const text = await dialog.getByTestId("whatsapp-text").inputValue();
  expect(text).toContain(`Outstanding balance: ${outstanding}`);
  expect(text).toContain("Sahyadri Snacks");
  expect(text).not.toMatch(/undefined|null|NaN/);

  const [popup] = await Promise.all([context.waitForEvent("page"), dialog.getByTestId("whatsapp-open").click()]);
  const url = new URL(popup.url());
  expect(url.origin + url.pathname).toBe("https://web.whatsapp.com/send");
  expect(url.searchParams.get("phone")).toBe("919000001001");
  expect(url.searchParams.get("text")).toBe(text);
  await expect(dialog.getByRole("status")).toContainText("press Send");
  expect(errors).toEqual([]);
  await context.close();
});

test("send balance due: download the PDF and share it on WhatsApp from a computer", async ({ browser }) => {
  const context = await desktop(browser);
  const page = await context.newPage();
  await login(page, USERS.wholesaler);
  await page.goto(`/w/retailers/${GANESH_ID}`);
  await page.getByRole("link", { name: "Send balance due" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/retailers/${GANESH_ID}/documents#balance`));
  await expectNoServerError(page);

  const panel = page.getByTestId("share-balance-due");
  await expect(panel).toHaveAttribute("data-ready", "true");
  await expect(panel).toContainText(/Ready: Balance-Due-Shree-Ganesh-Kirana-Stores-\d{4}-\d{2}-\d{2}\.pdf/);
  await expectPdfDownload(page, () => panel.getByTestId("download-pdf").click(), /^Balance-Due-Shree-Ganesh-Kirana-Stores-\d{4}-\d{2}-\d{2}\.pdf$/);

  // Share on WhatsApp: the chat opens with the message and the PDF downloads to attach.
  const [popup, download] = await Promise.all([context.waitForEvent("page"), page.waitForEvent("download"), panel.getByTestId("share-whatsapp").click()]);
  const url = new URL(popup.url());
  expect(url.searchParams.get("phone")).toBe("919000001001");
  expect(url.searchParams.get("text")).toContain("The PDF is attached to this message.");
  expect(url.searchParams.get("text")).toContain("Outstanding balance: ₹");
  expect(download.suggestedFilename()).toMatch(/^Balance-Due-.+\.pdf$/);
  await expect(panel.getByTestId("share-status")).toContainText("choose Document");
  await expect(panel.getByTestId("share-status")).toContainText("cannot attach files by themselves");

  // The full statement and a monthly statement.
  await expectPdfDownload(page, () => page.getByTestId("share-statement").getByTestId("download-pdf").click(), /^Account-Statement-Shree-Ganesh-Kirana-Stores-as-of-\d{4}-\d{2}-\d{2}\.pdf$/);
  await page.getByRole("button", { name: "Prepare monthly statement" }).click();
  const period = page.getByTestId("period-statement");
  await expect(period).toContainText("Monthly statement");
  await expect(page.getByTestId("share-period")).toHaveAttribute("data-ready", "true");
  await expectPdfDownload(page, () => page.getByTestId("share-period").getByTestId("download-pdf").click(), /^Monthly-Statement-Shree-Ganesh-Kirana-Stores-\d{4}-\d{2}-01-to-\d{4}-\d{2}-\d{2}\.pdf$/);

  // A date range that ends before it starts is refused with a clear message.
  await page.goto(`/w/retailers/${GANESH_ID}/documents?from=2026-10-10&to=2026-10-01`);
  await expect(page.getByText("The start date must be on or before the end date")).toBeVisible();
  await context.close();
});

test("phone with share sheet: the balance PDF is handed to the share sheet as a file", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: test.info().project.use.baseURL, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await stubWhatsApp(context);
  // Simulate a phone browser that supports sharing files (Web Share API level 2).
  await context.addInitScript(() => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    Object.defineProperty(navigator, "canShare", { value: (d: { files?: File[] }) => Boolean(d?.files?.length), configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (d: { files?: File[]; text?: string; title?: string }) => {
        w.__shared.push({ names: d.files?.map((f) => f.name), types: d.files?.map((f) => f.type), sizes: d.files?.map((f) => f.size), text: d.text });
      },
      configurable: true,
    });
  });
  const page = await context.newPage();
  await login(page, USERS.wholesaler);
  await page.goto(`/w/retailers/${GANESH_ID}/documents`);
  const panel = page.getByTestId("share-balance-due");
  await expect(panel).toHaveAttribute("data-can-share-files", "true");
  await panel.getByTestId("share-whatsapp").click();
  await expect(panel.getByTestId("share-status")).toContainText("Shared from your phone");
  const shared = (await page.evaluate(() => (window as unknown as { __shared: { names: string[]; types: string[]; sizes: number[]; text: string }[] }).__shared))[0]!;
  expect(shared.names[0]).toMatch(/^Balance-Due-.+\.pdf$/);
  expect(shared.types[0]).toBe("application/pdf");
  expect(shared.sizes[0]).toBeGreaterThan(5000);
  expect(shared.text).toContain("Outstanding balance: ₹");
  // No horizontal scrolling on the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await context.close();
});

test("phone without file sharing: falls back to WhatsApp chat plus download", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: test.info().project.use.baseURL, locale: "en-IN", timezoneId: "Asia/Kolkata", acceptDownloads: true });
  await stubWhatsApp(context);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  await login(page, USERS.wholesaler);
  await page.goto(`/w/retailers/${GANESH_ID}/documents`);
  const panel = page.getByTestId("share-balance-due");
  await expect(panel).toHaveAttribute("data-ready", "true");
  await expect(panel).toHaveAttribute("data-can-share-files", "false");
  await expect(panel.getByTestId("share-sheet")).toHaveCount(0);
  const [popup, download] = await Promise.all([context.waitForEvent("page"), page.waitForEvent("download"), panel.getByTestId("share-whatsapp").click()]);
  expect(new URL(popup.url()).origin).toBe("https://wa.me"); // phones use wa.me (the WhatsApp app)
  expect(new URL(popup.url()).pathname).toBe("/919000001001");
  expect(download.suggestedFilename()).toMatch(/^Balance-Due-.+\.pdf$/);
  await context.close();
});

test("invoice and receipt PDFs, and the invoice WhatsApp message", async ({ browser }) => {
  const context = await desktop(browser);
  const page = await context.newPage();
  await login(page, USERS.wholesaler);
  await page.goto("/w/billing");
  await page.locator("table a[href^='/w/billing/']").first().click();
  const number = (await page.getByRole("heading", { level: 1, name: /^Invoice / }).textContent())!.replace("Invoice ", "").trim();
  await expectPdfDownload(page, () => page.getByTestId("invoice-pdf").click(), new RegExp(`^Tax-Invoice-${number.replace(/[^\w-]+/g, "-")}\\.pdf$`));
  await page.getByTestId("whatsapp-composer").click();
  const text = await page.getByRole("dialog").getByTestId("whatsapp-text").inputValue();
  expect(text).toContain(`GST invoice ${number}`);
  expect(text).toMatch(/Invoice total: ₹[\d,]+\.\d{2}/);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await page.getByTestId("share-toggle").click();
  await expect(page.getByTestId("share-invoice")).toHaveAttribute("data-ready", "true");

  await page.goto("/w/payments");
  await page.locator("table a[href^='/w/payments/']").first().click();
  await expectPdfDownload(page, () => page.getByTestId("receipt-pdf").click(), /^Payment-Receipt-RCPT-\d{6}\.pdf$/);
  await context.close();
});

test("order page: retailer and delivery person messages follow the order", async ({ browser }) => {
  const context = await desktop(browser);
  const page = await context.newPage();
  await login(page, USERS.wholesaler);
  await page.goto("/w/orders");
  await page.locator("table a[href^='/w/orders/']").first().click();
  const orderNumber = (await page.getByRole("heading", { level: 1, name: /^Order / }).textContent())!.replace("Order ", "").trim();
  await page.getByRole("button", { name: "Message on WhatsApp" }).click();
  const dialog = page.getByRole("dialog");
  const text = await dialog.getByTestId("whatsapp-text").inputValue();
  expect(text).toContain(orderNumber);
  const options = await dialog.getByTestId("whatsapp-template").locator("option").allTextContents();
  expect(options).toContain("Order confirmation (received)");
  expect(options).toContain("General message");
  await context.close();
});

test("an invalid retailer number shows a clear error instead of opening WhatsApp", async ({ browser }) => {
  const context = await desktop(browser);
  const page = await context.newPage();
  // The shop saves a number that is not a mobile number (allowed by the form, unusable on WhatsApp).
  await login(page, USERS.pendingRetailer);
  await page.goto("/r/profile");
  const phone = page.getByLabel("Phone", { exact: true });
  const original = await phone.inputValue();
  await phone.fill("1234567890");
  await page.getByRole("button", { name: /^Save/ }).first().click();
  await expect(page.getByText(/saved|updated/i).first()).toBeVisible();

  await context.clearCookies();
  await login(page, USERS.wholesaler);
  await page.goto(`/w/retailers/${LAXMI_ID}`);
  await page.getByTestId("whatsapp-composer").click();
  await expect(page.getByRole("dialog").getByTestId("whatsapp-error")).toContainText("is not a valid mobile number for WhatsApp");
  await expect(page.getByRole("dialog").getByTestId("whatsapp-open")).toHaveCount(0);

  // Put the original number back.
  await context.clearCookies();
  await login(page, USERS.pendingRetailer);
  await page.goto("/r/profile");
  await page.getByLabel("Phone", { exact: true }).fill(original);
  await page.getByRole("button", { name: /^Save/ }).first().click();
  await expect(page.getByText(/saved|updated/i).first()).toBeVisible();
  await context.close();
});

test("retailer: invoice PDF and statement PDF downloads; other shops' documents are refused", async ({ browser }) => {
  const context = await desktop(browser);
  const page = await context.newPage();
  await login(page, USERS.retailer);
  await page.goto("/r/invoices");
  await page.locator("table a[href^='/r/invoices/']").first().click();
  const invoiceUrl = page.url();
  await expectPdfDownload(page, () => page.getByTestId("invoice-pdf").click(), /^Tax-Invoice-.+\.pdf$/);
  await page.goto("/r/payments");
  await page.locator('td[data-label="Wholesaler"] a').first().click();
  await expectPdfDownload(page, () => page.getByTestId("statement-pdf").click(), /^Account-Statement-.+\.pdf$/);

  // Another shop cannot fetch Ganesh's invoice PDF, and signed-out visitors get nothing.
  const invoiceId = invoiceUrl.split("/").pop()!;
  await context.clearCookies();
  await login(page, USERS.otherRetailer);
  expect((await page.request.get(`/r/documents/invoice/${invoiceId}`)).status()).toBe(404);
  expect((await page.request.get(`/w/documents/balance-due/${GANESH_ID}`)).status()).toBe(403);
  await context.clearCookies();
  await login(page, USERS.otherWholesaler);
  expect((await page.request.get(`/w/documents/invoice/${invoiceId}`)).status()).toBe(404);
  await context.clearCookies();
  const anon = await page.request.get(`/w/documents/balance-due/${GANESH_ID}`, { maxRedirects: 0 });
  expect([302, 303, 307, 401]).toContain(anon.status());
  await context.close();
});
