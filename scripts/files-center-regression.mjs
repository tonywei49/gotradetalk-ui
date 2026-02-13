import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const REQUIRED = [
  'PLAYWRIGHT_BASE_URL',
  'E2E_STAFF_COMPANY_SLUG',
  'E2E_STAFF_USERNAME',
  'E2E_STAFF_PASSWORD',
];

function mustEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function hsUrlFromStaffEnv() {
  const slug = mustEnv('E2E_STAFF_COMPANY_SLUG');
  const tld = process.env.E2E_STAFF_TLD || 'com';
  return `https://matrix.${slug}.${tld}`;
}

async function matrixLogin(hsUrl, username, password) {
  const res = await fetch(`${hsUrl}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Matrix login failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function createRoom(hsUrl, token, roomName) {
  const res = await fetch(`${hsUrl}/_matrix/client/v3/createRoom`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: roomName,
      visibility: 'private',
      preset: 'private_chat',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create room failed (${res.status}): ${text}`);
  }
  const body = await res.json();
  if (!body.room_id) throw new Error('Create room response missing room_id');
  return body.room_id;
}

async function uploadOneFixture(hsUrl, token, fileName, content) {
  const endpoint = `${hsUrl}/_matrix/media/v3/upload?filename=${encodeURIComponent(fileName)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'text/plain',
    },
    body: content,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Media upload failed (${res.status}): ${text}`);
  }
  const body = await res.json();
  if (!body.content_uri) throw new Error('Upload response missing content_uri');
  return body.content_uri;
}

async function sendFileEvents(hsUrl, token, roomId, mxcUrl, count) {
  for (let i = 0; i < count; i += 1) {
    const fileName = `reg-${i + 1}.txt`;
    const txnId = randomUUID();
    const endpoint = `${hsUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        msgtype: 'm.file',
        body: fileName,
        url: mxcUrl,
        info: {
          mimetype: 'text/plain',
          size: 64,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Send file event failed at index ${i} (${res.status}): ${text}`);
    }
  }
}

async function uiVerify(baseURL, staff, roomName) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const logs = [];
  const mark = (k, v = true) => logs.push(`${k}=${v}`);

  await page.goto(`${baseURL}/auth`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /staff/i }).click();

  const panel = page.locator('.gt_panel.active');
  await panel.waitFor({ state: 'visible' });
  const inputs = panel.locator('input');
  await inputs.nth(0).fill(staff.slug);

  const tldInput = inputs.nth(1);
  if (!(await tldInput.isEnabled())) {
    const toggle = panel.locator('.gt_inlineButton').first();
    if (await toggle.count()) await toggle.click();
  }
  if (await tldInput.isEnabled()) await tldInput.fill(staff.tld);

  await inputs.nth(2).fill(staff.username);
  await inputs.nth(3).fill(staff.password);
  await panel.locator('button[type="submit"]').first().click();

  await page.locator('[data-testid="chat-composer"]').first().waitFor({ timeout: 30000 });
  mark('login_ok');

  await page.locator('nav > div:nth-child(2) > div').nth(2).click({ timeout: 10000 });
  await page.waitForTimeout(900);

  const roomSearch = page.locator('input[placeholder*="搜尋聊天室"], input[placeholder*="Search rooms"]').first();
  await roomSearch.fill(roomName);
  await page.waitForTimeout(350);
  mark('room_search_ok');

  const roomBtn = page.getByRole('button', { name: new RegExp(roomName) }).first();
  await roomBtn.click({ timeout: 15000 });
  mark('room_select_ok');

  const loadMoreBtn = page.getByRole('button', { name: /載入更多|Load more/i }).first();
  await loadMoreBtn.waitFor({ state: 'visible', timeout: 45000 });
  mark('load_more_visible');

  const toolbarBtn = page.locator('main').getByRole('button', { name: /^\.\.\.$/ }).first();
  await toolbarBtn.click({ timeout: 10000 });

  const batchToggle = page.getByRole('button', { name: /批量選擇|Batch select/i }).first();
  await batchToggle.click({ timeout: 10000 });
  mark('batch_mode_enabled');

  const checkboxes = page.locator('main input[type="checkbox"]');
  const count = await checkboxes.count();
  const pick = Math.min(20, count);
  for (let i = 0; i < pick; i += 1) {
    await checkboxes.nth(i).check({ force: true });
  }
  mark('batch_items_checked', pick);

  const deleteBtn = page.getByRole('button', { name: /刪除已選|Delete selected/i }).first();
  await deleteBtn.click({ timeout: 10000 });

  const progress = page.getByText(/刪除中\s+\d+\s*\/\s*\d+|Deleting\s+\d+\s*\/\s*\d+/i).first();
  await progress.waitFor({ state: 'visible', timeout: 15000 });
  mark('batch_progress_visible');

  await page.waitForTimeout(800);
  console.log(logs.join('\n'));
  await browser.close();
}

async function main() {
  REQUIRED.forEach(mustEnv);

  const baseURL = mustEnv('PLAYWRIGHT_BASE_URL');
  const slug = mustEnv('E2E_STAFF_COMPANY_SLUG');
  const tld = process.env.E2E_STAFF_TLD || 'com';
  const username = mustEnv('E2E_STAFF_USERNAME');
  const password = mustEnv('E2E_STAFF_PASSWORD');

  const seedCount = Number(process.env.E2E_FILES_SEED_COUNT || '90');
  const roomName = process.env.E2E_FILES_ROOM_NAME || `regression-files-center-${Date.now()}`;

  const hsUrl = hsUrlFromStaffEnv();
  const login = await matrixLogin(hsUrl, username, password);
  const token = login.access_token;

  const roomId = await createRoom(hsUrl, token, roomName);
  const seedText = `files-center-regression seed for ${roomName}`;
  const sharedMxc = await uploadOneFixture(hsUrl, token, 'files-center-seed.txt', seedText);
  await sendFileEvents(hsUrl, token, roomId, sharedMxc, seedCount);

  console.log(`seed_room_id=${roomId}`);
  console.log(`seed_room_name=${roomName}`);
  console.log(`seed_count=${seedCount}`);

  await uiVerify(
    baseURL,
    { slug, tld, username, password },
    roomName,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
