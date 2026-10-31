/**
 * Forms keep what the user typed when the server rejects a submission, show
 * the error next to the field, and accept the corrected values.
 */
import { expect, test } from "@playwright/test";
import { USERS, login, uid } from "./helpers";

const GANESH_ID = "20000000-0000-4000-8000-000000000001";

test("add product: a mistake keeps every value and is shown on its field", async ({ page }) => {
  await login(page, USERS.wholesaler);
  await page.goto("/w/products/new");
  const sku = `E2E-FORM-${uid()}`;
  const name = `E2E Rusk ${sku}`;
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Category").selectOption({ label: "Biscuits" });
  await page.getByLabel("New brand name").fill("Test Bakers");
  await page.getByLabel("HSN code").fill("12"); // too short
  await page.locator('[name="variant.name"]').fill("200 g");
  await page.locator('[name="variant.sku"]').fill(sku);
  await page.locator('[name="variant.opening_stock"]').fill("120");
  await page.locator('[name="units.0.price"]').fill("25");
  await page.locator('[name="units.1.unit_code"]').selectOption({ label: "Box" });
  await page.locator('[name="units.1.factor_to_base"]').fill("24");
  await page.locator('[name="units.1.price"]').fill("580");
  await page.getByRole("button", { name: "Save product" }).click();

  // Error next to the HSN field; nothing typed is lost.
  await expect(page.getByText("HSN code has 4-8 digits")).toBeVisible();
  await expect(page).toHaveURL(/\/w\/products\/new/);
  await expect(page.getByLabel("Product name")).toHaveValue(name);
  await expect(page.getByLabel("New brand name")).toHaveValue("Test Bakers");
  await expect(page.locator('[name="variant.sku"]')).toHaveValue(sku);
  await expect(page.locator('[name="variant.opening_stock"]')).toHaveValue("120");
  await expect(page.locator('[name="units.0.price"]')).toHaveValue("25");
  await expect(page.locator('[name="units.1.factor_to_base"]')).toHaveValue("24");
  await expect(page.locator('[name="units.1.price"]')).toHaveValue("580");
  await expect(page.locator('[name="units.1.unit_code"]')).toHaveValue("box");

  // Correct only the wrong field and save.
  await page.getByLabel("HSN code").fill("1905");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL(/\/w\/products\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("add product: selling by the stock unit locks its pack size to 1", async ({ page }) => {
  await login(page, USERS.wholesaler);
  await page.goto("/w/products/new");
  await page.getByLabel("Stock is counted in").selectOption({ label: "Carton" });
  await expect(page.locator('[name="units.0.unit_code"]')).toHaveValue("carton");
  const pack = page.locator('[name="units.0.factor_to_base"]');
  await expect(pack).toHaveValue("1");
  await expect(pack).toHaveAttribute("readonly", "");

  // Choosing the same unit twice is reported on the second row, with values kept.
  await page.getByLabel("Product name").fill("Duplicate unit test");
  await page.getByLabel("Category").selectOption({ label: "Biscuits" });
  await page.locator('[name="variant.name"]').fill("1 carton");
  await page.locator('[name="variant.sku"]').fill(`E2E-DUP-${uid()}`);
  await page.locator('[name="units.0.price"]').fill("400");
  await page.locator('[name="units.1.unit_code"]').selectOption({ label: "Carton" });
  await page.locator('[name="units.1.price"]').fill("390");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText(/Already used in another row/)).toBeVisible();
  await expect(page.locator('[name="units.0.price"]')).toHaveValue("400");
  await expect(page.locator('[name="units.1.price"]')).toHaveValue("390");
});

test("record payment: an invalid amount keeps the other fields", async ({ page }) => {
  await login(page, USERS.wholesaler);
  await page.goto(`/w/payments/new?retailer=${GANESH_ID}`);
  const ref = `UPI-${uid()}`;
  await page.getByLabel("Amount received (₹)").fill("12.345");
  await page.getByLabel("Reference").fill(ref);
  await page.getByLabel("Notes").fill("Paid at the counter");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page).toHaveURL(/\/w\/payments\/new/);
  await expect(page.getByLabel("Amount received (₹)")).toHaveValue("12.345");
  await expect(page.getByLabel("Reference")).toHaveValue(ref);
  await expect(page.getByLabel("Notes")).toHaveValue("Paid at the counter");
});

test("register: a weak password keeps name and email", async ({ page }) => {
  await page.goto("/register?type=retailer");
  const email = `keep.${uid().toLowerCase()}@example.test`;
  await page.getByLabel("Your full name").fill("Form Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/at least 10 characters/i).first()).toBeVisible();
  await expect(page.getByLabel("Your full name")).toHaveValue("Form Tester");
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel(/I run a shop/)).toBeChecked();
});
