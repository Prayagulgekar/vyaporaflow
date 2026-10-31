/**
 * The admin sign-in page lets platform administrators in and turns everyone
 * else away without leaving them signed in.
 */
import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, USERS } from "./helpers";

const ADMIN = "admin@vyaporaflow.test";

test("an administrator signs in on the admin page and lands in the admin console", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Admin sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("Admin email").fill(ADMIN);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in to admin" }).click();
  await page.waitForURL(/\/admin$/);
  await page.goto("/admin/health");
  await expect(page.getByRole("heading", { name: /health/i }).first()).toBeVisible();
  // Visiting the admin sign-in page again goes straight to the console.
  await page.goto("/admin/login");
  await expect(page).toHaveURL(/\/admin$/);
});

test("signed-out visitors to the admin console are sent to the admin sign-in page", async ({ page }) => {
  await page.goto("/admin/companies");
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fcompanies/);
  await page.getByLabel("Admin email").fill(ADMIN);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in to admin" }).click();
  await page.waitForURL(/\/admin\/companies$/);
});

test("a business account is refused on the admin page and is not left signed in", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Admin email").fill(USERS.wholesaler);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in to admin" }).click();
  await expect(page.getByText("This account is not a platform administrator")).toBeVisible();
  await expect(page.getByLabel("Admin email")).toHaveValue(USERS.wholesaler);
  await page.goto("/w");
  await expect(page).toHaveURL(/\/login/);
});

test("a wrong admin password is refused", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Admin email").fill(ADMIN);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in to admin" }).click();
  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login/);
});
