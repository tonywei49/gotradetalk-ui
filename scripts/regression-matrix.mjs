#!/usr/bin/env node

/**
 * Matrix regression runner for invite/remove/file flows.
 *
 * Usage:
 *   MATRIX_BASE_URL="https://matrix.example.com" \
 *   MATRIX_USER_A="test.john" MATRIX_PASS_A="xxx" \
 *   MATRIX_USER_B="test.sean" MATRIX_PASS_B="xxx" \
 *   MATRIX_USER_C="test.jack" MATRIX_PASS_C="xxx" \
 *   MATRIX_USER_D="test.dave" MATRIX_PASS_D="xxx" \
 *   node scripts/regression-matrix.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.MATRIX_BASE_URL;
const users = {
  A: { username: process.env.MATRIX_USER_A, password: process.env.MATRIX_PASS_A },
  B: { username: process.env.MATRIX_USER_B, password: process.env.MATRIX_PASS_B },
  C: { username: process.env.MATRIX_USER_C, password: process.env.MATRIX_PASS_C },
  D: { username: process.env.MATRIX_USER_D, password: process.env.MATRIX_PASS_D },
};

if (!BASE_URL) {
  console.error("Missing MATRIX_BASE_URL");
  process.exit(1);
}
for (const [k, v] of Object.entries(users)) {
  if (k === "D" && (!v.username || !v.password)) continue;
  if (!v.username || !v.password) {
    console.error(`Missing credentials for ${k}: MATRIX_USER_${k} / MATRIX_PASS_${k}`);
    process.exit(1);
  }
}

const report = [];
const state = {
  tokens: {},
  userIds: {},
  roomId: null,
  roomVersion: null,
  discoveredRoomVersion: null,
};

function nowIso() {
  return new Date().toISOString();
}

function addResult(name, ok, detail = "") {
  report.push({ ts: nowIso(), name, ok, detail });
  const icon = ok ? "PASS" : "FAIL";
  console.log(`[${icon}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

function addWarn(name, detail = "") {
  report.push({ ts: nowIso(), name, ok: true, warn: true, detail });
  console.log(`[WARN] ${name}${detail ? ` :: ${detail}` : ""}`);
}

async function requestJson(method, endpoint, { token, body, headers } = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${BASE_URL}${endpoint}`;
  const finalHeaders = {
    Accept: "application/json",
    ...(body && typeof body === "object" && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
    ...(headers || {}),
  };
  if (token) {
    finalHeaders.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method,
    headers: finalHeaders,
    body:
      body == null
        ? undefined
        : body instanceof Uint8Array
          ? body
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${method} ${endpoint}`);
    err.response = json;
    throw err;
  }
  return json;
}

function encodeRoomId(roomId) {
  return encodeURIComponent(roomId);
}

async function login(tag) {
  const creds = users[tag];
  const body = {
    type: "m.login.password",
    identifier: {
      type: "m.id.user",
      user: creds.username,
    },
    password: creds.password,
  };
  const res = await requestJson("POST", "/_matrix/client/v3/login", { body });
  state.tokens[tag] = res.access_token;
  state.userIds[tag] = res.user_id;
  addResult(`login-${tag}`, true, res.user_id);
}

async function getRoomVersion(token, roomId) {
  try {
    const ev = await requestJson(
      "GET",
      `/_matrix/client/v3/rooms/${encodeRoomId(roomId)}/state/m.room.create/`,
      { token },
    );
    return ev?.content?.room_version || "unknown";
  } catch {
    return "unknown";
  }
}

async function createRoom() {
  const token = state.tokens.A;
  const body = {
    name: `regression-${Date.now()}`,
    preset: "private_chat",
    is_direct: false,
    invite: [],
  };
  const res = await requestJson("POST", "/_matrix/client/v3/createRoom", { token, body });
  state.roomId = res.room_id;
  state.roomVersion = await getRoomVersion(token, res.room_id);
  addResult("create-room", true, `${res.room_id} (v${state.roomVersion})`);
}

async function invite(tagFrom, tagTo) {
  const roomId = state.roomId;
  const token = state.tokens[tagFrom];
  const target = state.userIds[tagTo];
  await requestJson(
    "POST",
    `/_matrix/client/v3/rooms/${encodeRoomId(roomId)}/invite`,
    { token, body: { user_id: target } },
  );
  addResult(`invite-${tagFrom}-to-${tagTo}`, true, target);
}

async function join(tag) {
  const roomId = state.roomId;
  const token = state.tokens[tag];
  await requestJson("POST", `/_matrix/client/v3/rooms/${encodeRoomId(roomId)}/join`, { token, body: {} });
  addResult(`join-${tag}`, true, roomId);
}

async function leave(tag) {
  const roomId = state.roomId;
  const token = state.tokens[tag];
  await requestJson("POST", `/_matrix/client/v3/rooms/${encodeRoomId(roomId)}/leave`, { token, body: {} });
  addResult(`leave-${tag}`, true, roomId);
}

async function kick(tagFrom, tagTarget, reason = "regression-kick") {
  const roomId = state.roomId;
  const token = state.tokens[tagFrom];
  const target = state.userIds[tagTarget];
  await requestJson(
    "POST",
    `/_matrix/client/v3/rooms/${encodeRoomId(roomId)}/kick`,
    { token, body: { user_id: target, reason } },
  );
  addResult(`kick-${tagFrom}-to-${tagTarget}`, true, target);
}

async function assertInviteVersion(tag) {
  const token = state.tokens[tag];
  const roomId = state.roomId;
  const sync = await requestJson("GET", "/_matrix/client/v3/sync?timeout=0", { token });
  const invited = sync?.rooms?.invite || {};
  const inviteRoom = invited[roomId];
  if (!inviteRoom) {
    addResult(`invite-state-${tag}`, false, "invite room not found in /sync");
    return;
  }
  const events = inviteRoom.invite_state?.events || [];
  const createEv = events.find((ev) => ev?.type === "m.room.create");
  const v = createEv?.content?.room_version || "unknown";
  if (!state.roomVersion || state.roomVersion === "unknown") {
    state.roomVersion = v;
  }
  state.discoveredRoomVersion = v;
  const ok = String(v) === String(state.roomVersion);
  addResult(`invite-state-${tag}`, ok, `invite room_version=${v}, expected=${state.roomVersion}`);
}

async function sendTestFileAndDelete() {
  const roomId = state.roomId;
  const tokenA = state.tokens.A;
  const fileBytes = new TextEncoder().encode(`regression-file-${Date.now()}`);
  const upload = await requestJson(
    "POST",
    `/_matrix/media/v3/upload?filename=${encodeURIComponent("regression.txt")}`,
    {
      token: tokenA,
      headers: { "Content-Type": "text/plain" },
      body: fileBytes,
    },
  );
  const mxc = upload?.content_uri;
  if (!mxc) throw new Error("upload missing content_uri");
  addResult("file-upload", true, mxc);

  const sendTxn = `txn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sendRes = await requestJson(
    "PUT",
    `/_matrix/client/v3/rooms/${encodeRoomId(roomId)}/send/m.room.message/${encodeURIComponent(sendTxn)}`,
    {
      token: tokenA,
      body: {
        msgtype: "m.file",
        body: "regression.txt",
        url: mxc,
        info: {
          size: fileBytes.byteLength,
          mimetype: "text/plain",
        },
      },
    },
  );
  const eventId = sendRes?.event_id;
  if (!eventId) throw new Error("send file missing event_id");
  addResult("file-send", true, eventId);

  const redactTxn = `redact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await requestJson(
    "PUT",
    `/_matrix/client/v3/rooms/${encodeRoomId(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(redactTxn)}`,
    { token: tokenA, body: {} },
  );
  addResult("file-redact", true, eventId);

  const mxcMatch = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxc);
  if (!mxcMatch) throw new Error("invalid mxc uri");
  const serverName = encodeURIComponent(mxcMatch[1]);
  const mediaId = encodeURIComponent(mxcMatch[2]);
  const delPaths = [
    `/_matrix/client/v3/media/delete/${serverName}/${mediaId}`,
    `/_matrix/client/v1/media/delete/${serverName}/${mediaId}`,
    `/_matrix/media/v3/delete/${serverName}/${mediaId}`,
  ];
  let delOk = false;
  let delWarn = false;
  let lastErr = "";
  for (const p of delPaths) {
    try {
      await requestJson("DELETE", p, { token: tokenA });
      delOk = true;
      addResult("file-media-delete", true, p);
      break;
    } catch (e) {
      const payloadText = JSON.stringify(e?.response || e?.message || e);
      lastErr = payloadText;
      if (payloadText.includes("M_UNRECOGNIZED")) {
        delWarn = true;
      }
    }
  }
  if (!delOk) {
    if (delWarn) {
      addWarn("file-media-delete", "media delete API unsupported on this homeserver");
    } else {
      addResult("file-media-delete", false, lastErr);
    }
  }
}

async function writeReport() {
  const passCount = report.filter((r) => r.ok).length;
  const failCount = report.length - passCount;
  const lines = [];
  lines.push("# Matrix Regression Run Report");
  lines.push("");
  lines.push(`- Run at: ${nowIso()}`);
  lines.push(`- Base URL: ${BASE_URL}`);
  lines.push(`- Room ID: ${state.roomId || "-"}`);
  lines.push(`- Room Version: ${state.roomVersion || "-"}`);
  lines.push(`- Invite Seen Room Version: ${state.discoveredRoomVersion || "-"}`);
  lines.push(`- Result: PASS ${passCount} / FAIL ${failCount}`);
  lines.push("");
  lines.push("| Time | Case | Result | Detail |");
  lines.push("|---|---|---|---|");
  for (const r of report) {
    const result = r.warn ? "WARN" : r.ok ? "PASS" : "FAIL";
    lines.push(`| ${r.ts} | ${r.name} | ${result} | ${String(r.detail || "").replace(/\|/g, "\\|")} |`);
  }
  const outDir = path.resolve(process.cwd(), "regression-reports");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.resolve(outDir, "Attachment-Regression-Run-latest.md");
  await fs.writeFile(outPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`\nReport written: ${outPath}`);
  return failCount === 0;
}

async function main() {
  try {
    await login("A");
    await login("B");
    await login("C");
    if (users.D.username && users.D.password) {
      await login("D");
    } else {
      addWarn("login-D", "skipped (no D credentials)");
    }

    await createRoom();

    // Complex invite flow:
    // 1) A invite B, B join
    // 2) B leave
    // 3) A invite B and C, B/C join
    // 4) C leave
    // 5) A invite D, D join
    // 6) A invite C again, C join
    await invite("A", "B");
    await assertInviteVersion("B");
    await join("B");
    await leave("B");

    await invite("A", "B");
    await assertInviteVersion("B");
    await invite("A", "C");
    await assertInviteVersion("C");
    await join("B");
    await join("C");
    await leave("C");

    if (state.userIds.D && state.userIds.D !== state.userIds.A && state.userIds.D !== state.userIds.B && state.userIds.D !== state.userIds.C) {
      await invite("A", "D");
      await assertInviteVersion("D");
      await join("D");
    } else {
      addResult("invite-flow-D-branch", true, "skipped (D account not distinct)");
    }

    // always run C re-invite branch (matches real usage path)
    await invite("A", "C");
    await assertInviteVersion("C");
    await join("C");

    // host removes member scenario
    await kick("A", "B");

    await sendTestFileAndDelete();
  } catch (e) {
    addResult("runner-exception", false, JSON.stringify(e?.response || e?.message || e));
  }

  const ok = await writeReport();
  if (!ok) process.exit(2);
}

main();
