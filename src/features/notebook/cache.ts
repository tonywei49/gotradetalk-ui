import type { NotebookAuthContext, NotebookChunk, NotebookItem, NotebookParsedPreview } from "./types";
import { getNotebookCacheDb } from "./sqliteCache";
import { notebookAdapterMode } from "./adapterMode";

const NOTEBOOK_CACHE_PREFIX = "gtt:notebook";
const LIST_TTL_MS = 1000 * 60 * 30;
const PARSED_TTL_MS = 1000 * 60 * 30;
const MAX_PARSED_CACHE_ITEMS = 20;
type StoredListCacheEntry = {
    updatedAt: number;
    items: NotebookItem[];
    nextCursor: string | null;
};

type StoredParsedCacheEntry = {
    updatedAt: number;
    preview: NotebookParsedPreview | null;
    chunks: NotebookChunk[];
    chunksTotal: number;
    error: string | null;
};

export type NotebookPendingItemMutation = {
    itemId: string;
    operation: "create" | "update" | "delete";
    localModifiedAt: string;
    baseServerUpdatedAt: string | null;
    payload: Record<string, unknown>;
};

type SqliteRow = Record<string, unknown>;

function safeStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function normalizeNamespace(value: string): string {
    return encodeURIComponent(value);
}

function buildNamespace(auth: NotebookAuthContext | null): string | null {
    const matrixUserId = auth?.matrixUserId?.trim();
    const apiBaseUrl = auth?.apiBaseUrl?.trim();
    if (!matrixUserId || !apiBaseUrl) return null;
    return normalizeNamespace(`${apiBaseUrl}::${matrixUserId}::${notebookAdapterMode}`);
}

function readJson<T>(key: string): T | null {
    const storage = safeStorage();
    if (!storage) return null;
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        storage.removeItem(key);
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    const storage = safeStorage();
    if (!storage) return;
    storage.setItem(key, JSON.stringify(value));
}

function removeKey(key: string): void {
    const storage = safeStorage();
    if (!storage) return;
    storage.removeItem(key);
}

function listKey(namespace: string, cacheKey: string): string {
    return `${NOTEBOOK_CACHE_PREFIX}:list:${namespace}:${cacheKey}`;
}

function parsedKey(namespace: string, itemId: string): string {
    return `${NOTEBOOK_CACHE_PREFIX}:parsed:${namespace}:${itemId}`;
}

function parsedIndexKey(namespace: string): string {
    return `${NOTEBOOK_CACHE_PREFIX}:parsed-index:${namespace}`;
}

function pendingMutationsKey(namespace: string): string {
    return `${NOTEBOOK_CACHE_PREFIX}:pending:${namespace}`;
}

async function loadListCacheFromSqlite(cacheNamespace: string, cacheKey: string): Promise<StoredListCacheEntry | null> {
    const db = await getNotebookCacheDb();
    if (!db) return null;
    const rows = await db.select<SqliteRow[]>(
        "SELECT payload_json, updated_at FROM notebook_list_cache WHERE cache_namespace = $1 AND cache_key = $2 LIMIT 1",
        [cacheNamespace, cacheKey],
    );
    const row = rows[0];
    if (!row) return null;
    const updatedAt = Number(row.updated_at ?? 0);
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > LIST_TTL_MS) {
        await db.execute(
            "DELETE FROM notebook_list_cache WHERE cache_namespace = $1 AND cache_key = $2",
            [cacheNamespace, cacheKey],
        );
        return null;
    }
    try {
        const payload = JSON.parse(String(row.payload_json ?? "{}")) as Omit<StoredListCacheEntry, "updatedAt">;
        return {
            updatedAt,
            items: Array.isArray(payload.items) ? payload.items : [],
            nextCursor: payload.nextCursor ?? null,
        };
    } catch {
        await db.execute(
            "DELETE FROM notebook_list_cache WHERE cache_namespace = $1 AND cache_key = $2",
            [cacheNamespace, cacheKey],
        );
        return null;
    }
}

async function saveListCacheToSqlite(
    cacheNamespace: string,
    cacheKey: string,
    value: { items: NotebookItem[]; nextCursor: string | null },
): Promise<void> {
    const db = await getNotebookCacheDb();
    if (!db) return;
    await db.execute(
        `INSERT INTO notebook_list_cache (cache_namespace, cache_key, payload_json, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(cache_namespace, cache_key)
         DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
        [cacheNamespace, cacheKey, JSON.stringify(value), Date.now()],
    );
}

async function clearListCacheFromSqlite(cacheNamespace: string, cacheKey?: string): Promise<void> {
    const db = await getNotebookCacheDb();
    if (!db) return;
    if (cacheKey) {
        await db.execute(
            "DELETE FROM notebook_list_cache WHERE cache_namespace = $1 AND cache_key = $2",
            [cacheNamespace, cacheKey],
        );
        return;
    }
    await db.execute(
        "DELETE FROM notebook_list_cache WHERE cache_namespace = $1",
        [cacheNamespace],
    );
}

async function clearAllListCacheFromSqlite(): Promise<void> {
    const db = await getNotebookCacheDb();
    if (!db) return;
    await db.execute("DELETE FROM notebook_list_cache");
}

async function loadParsedCacheFromSqlite(
    cacheNamespace: string,
    itemId: string,
): Promise<StoredParsedCacheEntry | null> {
    const db = await getNotebookCacheDb();
    if (!db) return null;
    const rows = await db.select<SqliteRow[]>(
        "SELECT preview_json, chunks_json, chunks_total, error, updated_at FROM notebook_parsed_cache WHERE cache_namespace = $1 AND item_id = $2 LIMIT 1",
        [cacheNamespace, itemId],
    );
    const row = rows[0];
    if (!row) return null;
    const updatedAt = Number(row.updated_at ?? 0);
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > PARSED_TTL_MS) {
        await db.execute(
            "DELETE FROM notebook_parsed_cache WHERE cache_namespace = $1 AND item_id = $2",
            [cacheNamespace, itemId],
        );
        return null;
    }
    try {
        return {
            updatedAt,
            preview: row.preview_json ? (JSON.parse(String(row.preview_json)) as NotebookParsedPreview | null) : null,
            chunks: row.chunks_json ? (JSON.parse(String(row.chunks_json)) as NotebookChunk[]) : [],
            chunksTotal: Number(row.chunks_total ?? 0),
            error: row.error == null ? null : String(row.error),
        };
    } catch {
        await db.execute(
            "DELETE FROM notebook_parsed_cache WHERE cache_namespace = $1 AND item_id = $2",
            [cacheNamespace, itemId],
        );
        return null;
    }
}

async function saveParsedCacheToSqlite(
    cacheNamespace: string,
    itemId: string,
    value: Omit<StoredParsedCacheEntry, "updatedAt">,
): Promise<void> {
    const db = await getNotebookCacheDb();
    if (!db) return;
    const now = Date.now();
    await db.execute(
        `INSERT INTO notebook_parsed_cache (cache_namespace, item_id, preview_json, chunks_json, chunks_total, error, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT(cache_namespace, item_id)
         DO UPDATE SET
           preview_json = excluded.preview_json,
           chunks_json = excluded.chunks_json,
           chunks_total = excluded.chunks_total,
           error = excluded.error,
           updated_at = excluded.updated_at`,
        [
            cacheNamespace,
            itemId,
            JSON.stringify(value.preview),
            JSON.stringify(value.chunks),
            value.chunksTotal,
            value.error,
            now,
        ],
    );

    await db.execute(
        `INSERT INTO notebook_parsed_cache_index (cache_namespace, item_id, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(cache_namespace, item_id)
         DO UPDATE SET updated_at = excluded.updated_at`,
        [cacheNamespace, itemId, now],
    );

    const staleRows = await db.select<SqliteRow[]>(
        `SELECT item_id FROM notebook_parsed_cache_index
         WHERE cache_namespace = $1
         ORDER BY updated_at DESC
         LIMIT -1 OFFSET $2`,
        [cacheNamespace, MAX_PARSED_CACHE_ITEMS],
    );

    for (const row of staleRows) {
        const staleItemId = String(row.item_id ?? "");
        if (!staleItemId) continue;
        await db.execute(
            "DELETE FROM notebook_parsed_cache WHERE cache_namespace = $1 AND item_id = $2",
            [cacheNamespace, staleItemId],
        );
        await db.execute(
            "DELETE FROM notebook_parsed_cache_index WHERE cache_namespace = $1 AND item_id = $2",
            [cacheNamespace, staleItemId],
        );
    }
}

async function clearParsedCacheFromSqlite(cacheNamespace: string, itemId?: string): Promise<void> {
    const db = await getNotebookCacheDb();
    if (!db) return;
    if (itemId) {
        await db.execute(
            "DELETE FROM notebook_parsed_cache WHERE cache_namespace = $1 AND item_id = $2",
            [cacheNamespace, itemId],
        );
        await db.execute(
            "DELETE FROM notebook_parsed_cache_index WHERE cache_namespace = $1 AND item_id = $2",
            [cacheNamespace, itemId],
        );
        return;
    }

    await db.execute(
        "DELETE FROM notebook_parsed_cache WHERE cache_namespace = $1",
        [cacheNamespace],
    );
    await db.execute(
        "DELETE FROM notebook_parsed_cache_index WHERE cache_namespace = $1",
        [cacheNamespace],
    );
}

async function clearAllParsedCacheFromSqlite(): Promise<void> {
    const db = await getNotebookCacheDb();
    if (!db) return;
    await db.execute("DELETE FROM notebook_parsed_cache");
    await db.execute("DELETE FROM notebook_parsed_cache_index");
}

export async function loadNotebookListCache(
    auth: NotebookAuthContext | null,
    cacheKey: string,
): Promise<{ items: NotebookItem[]; nextCursor: string | null } | null> {
    const namespace = buildNamespace(auth);
    if (!namespace) return null;

    const sqliteCached = await loadListCacheFromSqlite(namespace, cacheKey);
    if (sqliteCached) {
        return {
            items: sqliteCached.items,
            nextCursor: sqliteCached.nextCursor,
        };
    }

    const key = listKey(namespace, cacheKey);
    const stored = readJson<StoredListCacheEntry>(key);
    if (!stored) return null;
    if (Date.now() - stored.updatedAt > LIST_TTL_MS) {
        removeKey(key);
        return null;
    }
    return {
        items: Array.isArray(stored.items) ? stored.items : [],
        nextCursor: stored.nextCursor ?? null,
    };
}

export function peekNotebookListCache(
    auth: NotebookAuthContext | null,
    cacheKey: string,
): { items: NotebookItem[]; nextCursor: string | null } | null {
    const namespace = buildNamespace(auth);
    if (!namespace) return null;

    const key = listKey(namespace, cacheKey);
    const stored = readJson<StoredListCacheEntry>(key);
    if (!stored) return null;
    if (Date.now() - stored.updatedAt > LIST_TTL_MS) {
        removeKey(key);
        return null;
    }
    return {
        items: Array.isArray(stored.items) ? stored.items : [],
        nextCursor: stored.nextCursor ?? null,
    };
}

export async function saveNotebookListCache(
    auth: NotebookAuthContext | null,
    cacheKey: string,
    value: { items: NotebookItem[]; nextCursor: string | null },
): Promise<void> {
    const namespace = buildNamespace(auth);
    if (!namespace) return;

    await saveListCacheToSqlite(namespace, cacheKey, value);
    writeJson(listKey(namespace, cacheKey), {
        updatedAt: Date.now(),
        items: value.items,
        nextCursor: value.nextCursor,
    } satisfies StoredListCacheEntry);
}

export async function clearNotebookListCache(
    auth: NotebookAuthContext | null,
    cacheKey?: string,
): Promise<void> {
    const namespace = buildNamespace(auth);
    if (!namespace) return;

    await clearListCacheFromSqlite(namespace, cacheKey);

    const storage = safeStorage();
    if (!storage) return;

    if (cacheKey) {
        removeKey(listKey(namespace, cacheKey));
        return;
    }

    const prefix = `${NOTEBOOK_CACHE_PREFIX}:list:${namespace}:`;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) {
            storage.removeItem(key);
        }
    }
}

export async function clearNotebookParsedCache(
    auth: NotebookAuthContext | null,
    itemId?: string,
): Promise<void> {
    const namespace = buildNamespace(auth);
    if (!namespace) return;

    await clearParsedCacheFromSqlite(namespace, itemId);

    const storage = safeStorage();
    if (!storage) return;

    if (itemId) {
        removeKey(parsedKey(namespace, itemId));
        const indexKey = parsedIndexKey(namespace);
        const current = readJson<string[]>(indexKey) ?? [];
        writeJson(indexKey, current.filter((entry) => entry !== itemId));
        return;
    }

    const parsedPrefix = `${NOTEBOOK_CACHE_PREFIX}:parsed:${namespace}:`;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(parsedPrefix)) {
            storage.removeItem(key);
        }
    }
    removeKey(parsedIndexKey(namespace));
}

export async function clearAllNotebookCache(): Promise<void> {
    await Promise.all([
        clearAllListCacheFromSqlite(),
        clearAllParsedCacheFromSqlite(),
    ]);

    const storage = safeStorage();
    if (!storage) return;

    const prefix = `${NOTEBOOK_CACHE_PREFIX}:`;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) {
            storage.removeItem(key);
        }
    }
}

export function loadNotebookPendingMutations(auth: NotebookAuthContext | null): NotebookPendingItemMutation[] {
    const namespace = buildNamespace(auth);
    if (!namespace) return [];
    return readJson<NotebookPendingItemMutation[]>(pendingMutationsKey(namespace)) ?? [];
}

export function saveNotebookPendingMutations(
    auth: NotebookAuthContext | null,
    value: NotebookPendingItemMutation[],
): void {
    const namespace = buildNamespace(auth);
    if (!namespace) return;
    writeJson(pendingMutationsKey(namespace), value);
}

export async function loadNotebookParsedCache(
    auth: NotebookAuthContext | null,
    itemId: string,
): Promise<StoredParsedCacheEntry | null> {
    const namespace = buildNamespace(auth);
    if (!namespace) return null;

    const sqliteCached = await loadParsedCacheFromSqlite(namespace, itemId);
    if (sqliteCached) return sqliteCached;

    const key = parsedKey(namespace, itemId);
    const stored = readJson<StoredParsedCacheEntry>(key);
    if (!stored) return null;
    if (Date.now() - stored.updatedAt > PARSED_TTL_MS) {
        removeKey(key);
        return null;
    }
    return stored;
}

export async function saveNotebookParsedCache(
    auth: NotebookAuthContext | null,
    itemId: string,
    value: Omit<StoredParsedCacheEntry, "updatedAt">,
): Promise<void> {
    const namespace = buildNamespace(auth);
    if (!namespace) return;

    await saveParsedCacheToSqlite(namespace, itemId, value);

    const key = parsedKey(namespace, itemId);
    writeJson(key, {
        updatedAt: Date.now(),
        ...value,
    } satisfies StoredParsedCacheEntry);

    const indexKey = parsedIndexKey(namespace);
    const current = readJson<string[]>(indexKey) ?? [];
    const next = [itemId, ...current.filter((entry) => entry !== itemId)].slice(0, MAX_PARSED_CACHE_ITEMS);
    writeJson(indexKey, next);

    current
        .filter((entry) => !next.includes(entry))
        .forEach((entry) => removeKey(parsedKey(namespace, entry)));
}
