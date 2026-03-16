import { test, expect } from "@playwright/test";

test("mobile auth layout smoke", async ({ page }) => {
  await page.goto("/auth");

  await expect(page.getByText("GoTradeTalk")).toBeVisible();
  await expect(page.locator('[data-testid="auth-client-username"]')).toBeVisible();
  await expect(page.locator('[data-testid="auth-client-password"]')).toBeVisible();
  await expect(page.locator('[data-testid="auth-client-submit"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  await expect(page.locator("select").first()).toBeVisible();

  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);
});
