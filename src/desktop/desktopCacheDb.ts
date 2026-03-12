import Database from "@tauri-apps/plugin-sql";

import { isTauriDesktop } from "./fetchWithDesktopSupport";

const DESKTOP_CACHE_DB = "sqlite:desktop-cache.db";

let dbPromise: Promise<Database> | null = null;

async function getDesktopCacheDb(): Promise<Database | null> {
    if (!isTauriDesktop()) return null;
    if (!dbPromise) {
        dbPromise = Database.load(DESKTOP_CACHE_DB);
    }
    return dbPromise;
}

async function readPayload<T>(query: string, bindValues: unknown[] = [], maxAgeMs?: number): Promise<T | null> {
    const db = await getDesktopCacheDb();
    if (!db) return null;
    try {
        const rows = await db.select<Array<{ payload_json?: string | null; updated_at?: number | null }>>(query, bindValues);
        const raw = rows[0]?.payload_json;
        if (!raw) return null;
        const updatedAt = Number(rows[0]?.updated_at ?? 0);
        if (maxAgeMs && Number.isFinite(updatedAt) && updatedAt > 0 && updatedAt + maxAgeMs < Date.now()) {
            return null;
        }
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

async function writePayload(query: string, bindValues: unknown[] = []): Promise<void> {
    const db = await getDesktopCacheDb();
    if (!db) return;
    try {
        await db.execute(query, bindValues);
    } catch {
        // ignore desktop cache write failures
    }
}

export async function readWorkspaceStateFromSqlite<T>(userId: string | null, maxAgeMs?: number): Promise<T | null> {
    if (!userId) return null;
    return readPayload<T>(
        "SELECT payload_json, updated_at FROM workspace_state_cache WHERE user_id = ? LIMIT 1",
        [userId],
        maxAgeMs,
    );
}

export async function writeWorkspaceStateToSqlite<T>(userId: string | null, payload: T): Promise<void> {
    if (!userId) return;
    await writePayload(
        `INSERT INTO workspace_state_cache (user_id, payload_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
        [userId, JSON.stringify(payload), Date.now()],
    );
}

export async function readRoomListCacheFromSqlite<T>(userId: string | null, maxAgeMs?: number): Promise<T | null> {
    if (!userId) return null;
    return readPayload<T>(
        "SELECT payload_json, updated_at FROM room_list_cache WHERE user_id = ? LIMIT 1",
        [userId],
        maxAgeMs,
    );
}

export async function writeRoomListCacheToSqlite<T>(userId: string | null, payload: T): Promise<void> {
    if (!userId) return;
    await writePayload(
        `INSERT INTO room_list_cache (user_id, payload_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
        [userId, JSON.stringify(payload), Date.now()],
    );
}

export async function readContactsCacheFromSqlite<T>(userId: string | null, maxAgeMs?: number): Promise<T | null> {
    if (!userId) return null;
    return readPayload<T>(
        "SELECT payload_json, updated_at FROM contacts_cache WHERE user_id = ? LIMIT 1",
        [userId],
        maxAgeMs,
    );
}

export async function writeContactsCacheToSqlite<T>(userId: string | null, payload: T): Promise<void> {
    if (!userId) return;
    await writePayload(
        `INSERT INTO contacts_cache (user_id, payload_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
        [userId, JSON.stringify(payload), Date.now()],
    );
}

export async function readRoomTimelineCacheFromSqlite<T>(userId: string | null, roomId: string | null, maxAgeMs?: number): Promise<T | null> {
    if (!userId || !roomId) return null;
    return readPayload<T>(
        "SELECT payload_json, updated_at FROM room_timeline_cache WHERE user_id = ? AND room_id = ? LIMIT 1",
        [userId, roomId],
        maxAgeMs,
    );
}

export async function writeRoomTimelineCacheToSqlite<T>(userId: string | null, roomId: string | null, payload: T): Promise<void> {
    if (!userId || !roomId) return;
    await writePayload(
        `INSERT INTO room_timeline_cache (user_id, room_id, payload_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, room_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
        [userId, roomId, JSON.stringify(payload), Date.now()],
    );
}

export async function readUiStateFromSqlite<T>(scope: string, itemKey: string | null, maxAgeMs?: number): Promise<T | null> {
    if (!itemKey) return null;
    return readPayload<T>(
        "SELECT payload_json, updated_at FROM ui_state_cache WHERE scope = ? AND item_key = ? LIMIT 1",
        [scope, itemKey],
        maxAgeMs,
    );
}

export async function writeUiStateToSqlite<T>(scope: string, itemKey: string | null, payload: T): Promise<void> {
    if (!itemKey) return;
    await writePayload(
        `INSERT INTO ui_state_cache (scope, item_key, payload_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope, item_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
        [scope, itemKey, JSON.stringify(payload), Date.now()],
    );
}
