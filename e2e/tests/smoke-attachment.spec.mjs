import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.resolve(__dirname, "../fixtures/attachment-smoke.txt");

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

async function closeCreateGroupModalIfPresent(page) {
  const modal = firstLocator(page, [
    'div.fixed.inset-0.z-50:has-text("创建聊天室")',
    'div.fixed.inset-0.z-50:has-text("建立聊天室")',
    'div.fixed.inset-0.z-50:has-text("Create Room")',
    'div.fixed.inset-0.z-50:has-text("创建群聊")',
    'div.fixed.inset-0.z-50:has-text("建立群聊")',
    'div.fixed.inset-0.z-50:has-text("Create Group")',
  ]).first();
  if (!(await modal.isVisible().catch(() => false))) return;
  await modal.locator("button").first().click({ force: true }).catch(() => {});
  await modal.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

async function login(page) {
  const mode = (process.env.E2E_LOGIN_MODE || "client").toLowerCase();

  if (mode === "staff") {
    const slug = getRequiredEnv("E2E_STAFF_COMPANY_SLUG");
    const username = getRequiredEnv("E2E_STAFF_USERNAME");
    const password = getRequiredEnv("E2E_STAFF_PASSWORD");
    const tld = process.env.E2E_STAFF_TLD || "com";

    await page.getByRole("button", { name: /staff/i }).click();
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

    await firstLocator(page, ['[data-testid="auth-client-username"]', 'input[autocomplete="username"]'])
      .first()
      .fill(username);
    await firstLocator(page, ['[data-testid="auth-client-password"]', 'input[autocomplete="current-password"]'])
      .first()
      .fill(password);
    await firstLocator(page, ['[data-testid="auth-client-submit"]', 'form button[type="submit"]'])
      .first()
      .click();
  }

  const composer = firstLocator(page, ['[data-testid="chat-composer"]', "textarea[placeholder]"]).first();
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

test("upload -> send -> delete file message smoke", async ({ page }) => {
  await page.goto("/auth");
  await login(page);

  await closeCreateGroupModalIfPresent(page);

  const roomHint = (process.env.E2E_ROOM_HINT || "").trim();
  if (roomHint) {
    const hintedRoom = page.locator("aside button").filter({ hasText: roomHint }).first();
    if ((await hintedRoom.count()) > 0) {
      await hintedRoom.click();
    }
  } else {
    const firstRoom = firstLocator(page, ['[data-testid^="room-list-item-"]', "aside button"]);
    if ((await firstRoom.count()) > 0) {
      await firstRoom.first().click();
    }
  }

  const fileInput = firstLocator(page, ['[data-testid="chat-file-input"]', 'input[type="file"]']).first();
  await fileInput.setInputFiles(fixturePath);

  await expect(page.getByText(/attachment-smoke\.txt/i).first()).toBeVisible();
  await expect(page.locator("text=/上傳完成|ready to send/i")).toBeVisible({ timeout: 30000 });
  await closeCreateGroupModalIfPresent(page);

  const composerInput = firstLocator(page, [
    '[data-testid="chat-composer-input"]',
    '[data-testid="chat-composer"] textarea',
    'textarea[placeholder*="输入消息"]',
    'textarea[placeholder*="輸入訊息"]',
    'textarea[placeholder*="message"]',
  ]).first();
  await composerInput.click();
  await composerInput.press("Enter");

  const actionTrigger = firstLocator(page, [
    '[data-testid^="chat-file-action-trigger-"]',
    'button[aria-label*="檔案操作"]',
    'button[aria-label*="file"]',
    'button[aria-label*="檔案"]',
    'button[aria-label*="文件"]',
  ]).last();
  await expect(actionTrigger).toBeVisible();
  const triggerId = (await actionTrigger.getAttribute("data-testid")) || "";
  const eventId = triggerId.startsWith("chat-file-action-trigger-")
    ? triggerId.slice("chat-file-action-trigger-".length)
    : "";
  await actionTrigger.click();

  const deleteButton = firstLocator(page, [
    '[data-testid^="chat-file-delete-"]',
    'button:has-text("Delete")',
    'button:has-text("刪除")',
    'button:has-text("删除")',
  ]).last();
  await deleteButton.click();

  const revokeNotice = page.locator("text=/撤回一個文件|撤回一个文件|revoked a file/i").last();
  if (eventId) {
    const deletedEventTrigger = page.locator(`[data-testid="chat-file-action-trigger-${eventId}"]`);
    await expect(async () => {
      const noticeVisible = await revokeNotice.isVisible().catch(() => false);
      const triggerStillVisible = await deletedEventTrigger.isVisible().catch(() => false);
      expect(noticeVisible || !triggerStillVisible).toBeTruthy();
    }).toPass({ timeout: 15000 });
  } else {
    await expect(revokeNotice).toBeVisible({ timeout: 15000 });
  }
});
