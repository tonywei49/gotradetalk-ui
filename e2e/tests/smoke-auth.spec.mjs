import { test, expect } from "@playwright/test";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function firstLocator(page, selectors) {
  return page.locator(selectors.join(", "));
}

async function loginOrFail(page) {
  const mode = (process.env.E2E_LOGIN_MODE || "client").toLowerCase();

  if (mode === "staff") {
    const slug = getRequiredEnv("E2E_STAFF_COMPANY_SLUG");
    const username = getRequiredEnv("E2E_STAFF_USERNAME");
    const password = getRequiredEnv("E2E_STAFF_PASSWORD");
    const tld = process.env.E2E_STAFF_TLD || "com";

    await page.getByRole("button", { name: /staff|company/i }).click();
    const activePanel = page.locator(".gt_panel.active");
    await expect(activePanel).toBeVisible();

    const inputs = activePanel.locator("input");
    await inputs.nth(0).fill(slug);
    const tldInput = inputs.nth(1);
    if (!(await tldInput.isEnabled())) {
      const toggle = activePanel.locator(".gt_inlineButton").first();
      if (await toggle.count()) await toggle.click();
    }
    if (await tldInput.isEnabled()) await tldInput.fill(tld);
    await inputs.nth(2).fill(username);
    await inputs.nth(3).fill(password);
    await activePanel.locator('button[type="submit"]').first().click();
  } else {
    const username = getRequiredEnv("E2E_CLIENT_USERNAME");
    const password = getRequiredEnv("E2E_CLIENT_PASSWORD");

    const usernameInput = firstLocator(page, [
      '[data-testid="auth-client-username"]',
      'input[autocomplete="username"]',
    ]);
    const passwordInput = firstLocator(page, [
      '[data-testid="auth-client-password"]',
      'input[autocomplete="current-password"]',
    ]);
    const submitButton = firstLocator(page, [
      '[data-testid="auth-client-submit"]',
      'form button[type="submit"]',
    ]);

    await expect(usernameInput.first()).toBeVisible();
    await usernameInput.first().fill(username);
    await passwordInput.first().fill(password);
    await submitButton.first().click();
  }

  const composer = firstLocator(page, ['[data-testid="chat-composer"]', 'textarea[placeholder]']).first();
  const errorBanner = page.locator(".gt_error, .error, [role='alert']").first();

  const result = await Promise.race([
    composer.waitFor({ state: "visible", timeout: 20000 }).then(() => "ok"),
    errorBanner
      .waitFor({ state: "visible", timeout: 20000 })
      .then(async () => `error:${(await errorBanner.textContent()) || "login failed"}`),
  ]);

  if (result !== "ok") {
    throw new Error(`Login failed: ${result.replace(/^error:/, "").trim()}`);
  }
}

test("client login smoke", async ({ page }) => {
  await page.goto("/auth");
  await loginOrFail(page);
  await expect(
    firstLocator(page, ['[data-testid="chat-composer"]', 'textarea[placeholder]']).first(),
  ).toBeVisible();
  await expect(
    firstLocator(page, ['[data-testid="chat-timeline"]', "main"]).first(),
  ).toBeVisible();
});

test("invalid credentials should show toast", async ({ page }) => {
  await page.goto("/auth");

  const mode = (process.env.E2E_LOGIN_MODE || "client").toLowerCase();

  if (mode === "staff") {
    const slug = getRequiredEnv("E2E_STAFF_COMPANY_SLUG");
    const username = getRequiredEnv("E2E_STAFF_USERNAME");
    const password = getRequiredEnv("E2E_STAFF_PASSWORD");
    const tld = process.env.E2E_STAFF_TLD || "com";

    await page.getByRole("button", { name: /staff|company/i }).click();
    const activePanel = page.locator(".gt_panel.active");
    await expect(activePanel).toBeVisible();

    const inputs = activePanel.locator("input");
    await inputs.nth(0).fill(slug);
    const tldInput = inputs.nth(1);
    if (!(await tldInput.isEnabled())) {
      const toggle = activePanel.locator(".gt_inlineButton").first();
      if (await toggle.count()) await toggle.click();
    }
    if (await tldInput.isEnabled()) await tldInput.fill(tld);
    await inputs.nth(2).fill(username);
    await inputs.nth(3).fill(`${password}__invalid__`);
    await activePanel.locator('button[type="submit"]').first().click();
  } else {
    const username = getRequiredEnv("E2E_CLIENT_USERNAME");
    const password = getRequiredEnv("E2E_CLIENT_PASSWORD");

    const usernameInput = firstLocator(page, [
      '[data-testid="auth-client-username"]',
      'input[autocomplete="username"]',
    ]);
    const passwordInput = firstLocator(page, [
      '[data-testid="auth-client-password"]',
      'input[autocomplete="current-password"]',
    ]);
    const submitButton = firstLocator(page, [
      '[data-testid="auth-client-submit"]',
      'form button[type="submit"]',
    ]);

    await expect(usernameInput.first()).toBeVisible();
    await usernameInput.first().fill(username);
    await passwordInput.first().fill(`${password}__invalid__`);
    await submitButton.first().click();
  }

  await expect(page.locator('[data-testid="toast-item"]').first()).toBeVisible();
});
