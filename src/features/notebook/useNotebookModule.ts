import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NotebookApiError, type NotebookAdapter } from "./adapters/types";
import type { NotebookAuthContext, NotebookItem, NotebookItemFile, NotebookListState } from "./types";
import { useNotebookParsedView } from "./hooks/useNotebookParsedView";
import { useNotebookItemFiles } from "./hooks/useNotebookItemFiles";
import { defaultChunkSettings, type ChunkSettings } from "./components/ChunkSettingsPanel";
import {
    clearNotebookListCache,
    loadNotebookListCache,
    loadNotebookPendingMutations,
    peekNotebookListCache,
    saveNotebookListCache,
    saveNotebookPendingMutations,
    type NotebookPendingItemMutation,
} from "./cache";

type UseNotebookModuleParams = {
    adapter: NotebookAdapter;
    auth: NotebookAuthContext | null;
    enabled: boolean;
    refreshToken: number;
};

export type NotebookViewFilter = "all" | "knowledge" | "note";
export type NotebookSourceScope = "personal" | "company" | "both";

const NOTEBOOK_SYNC_COOLDOWN_MS = 5_000;
const NOTEBOOK_SYNC_PAGE_SIZE = 100;
const NOTEBOOK_SNAPSHOT_CACHE_KEY = "__snapshot__:all:both";
const NOTEBOOK_SYNC_TIMEOUT_MS = 20_000;
const NOTEBOOK_SYNC_MAX_PAGES = 100;

function deriveItemsFromAllCache(
    allCache: { items: NotebookItem[]; nextCursor: string | null } | null,
    viewFilter: NotebookViewFilter,
    sourceScope: NotebookSourceScope,
    keyword: string,
): { items: NotebookItem[]; nextCursor: string | null } | null {
    if (!allCache) return null;
    const normalizedKeyword = keyword.trim().toLowerCase();
    const filtered = allCache.items.filter((item) => {
        if (sourceScope === "company" && item.sourceScope !== "company") return false;
        if (sourceScope === "personal" && item.sourceScope === "company") return false;
        if (viewFilter === "knowledge" && !item.isIndexable) return false;
        if (viewFilter === "note" && item.isIndexable) return false;
        if (normalizedKeyword) {
            const haystack = `${item.title || ""}\n${item.contentMarkdown || ""}\n${item.sourceFileName || ""}`.toLowerCase();
            if (!haystack.includes(normalizedKeyword)) return false;
        }
        return true;
    });
    return {
        items: filtered,
        nextCursor: null,
    };
}

function deriveCountsFromAllCache(
    allCache: { items: NotebookItem[]; nextCursor: string | null } | null,
    sourceScope: NotebookSourceScope,
    keyword: string,
): { all: number; knowledge: number; note: number } {
    if (!allCache) {
        return { all: 0, knowledge: 0, note: 0 };
    }

    const normalizedKeyword = keyword.trim().toLowerCase();
    return allCache.items.reduce((acc, item) => {
        if (sourceScope === "company" && item.sourceScope !== "company") return acc;
        if (sourceScope === "personal" && item.sourceScope === "company") return acc;
        if (normalizedKeyword) {
            const haystack = `${item.title || ""}\n${item.contentMarkdown || ""}\n${item.sourceFileName || ""}`.toLowerCase();
            if (!haystack.includes(normalizedKeyword)) return acc;
        }
        acc.all += 1;
        if (item.isIndexable) {
            acc.knowledge += 1;
        } else {
            acc.note += 1;
        }
        return acc;
    }, { all: 0, knowledge: 0, note: 0 });
}

function describeNotebookError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    if (error && typeof error === "object") {
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }
    return "Failed to load notebook items";
}

function isOfflineEnvironment(): boolean {
    return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isNetworkFailureMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes("failed to fetch")
        || normalized.includes("networkerror")
        || normalized.includes("network request failed")
        || normalized.includes("network error")
        || normalized.includes("dns error")
        || normalized.includes("connection refused")
        || normalized.includes("connection reset")
        || normalized.includes("operation timed out")
        || normalized.includes("timed out")
        || normalized.includes("timeout")
        || normalized.includes("offline")
        || normalized.includes("unreachable")
        || normalized.includes("socket")
        || normalized.includes("transport")
        || normalized.includes("channel")
        || normalized.includes("os error")
        || normalized.includes("error sending request")
        || normalized.includes("client error")
        || normalized.includes("server closed the connection")
        || normalized.includes("unknown notebook api error");
}

function shouldFallbackToOffline(error: unknown): boolean {
    if (isOfflineEnvironment()) return true;
    if (error instanceof NotebookApiError) {
        if (error.code === "NETWORK_ERROR" || error.status === 0) {
            return true;
        }
        return isNetworkFailureMessage(error.message);
    }
    return isNetworkFailureMessage(describeNotebookError(error));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: number | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = window.setTimeout(() => {
                    reject(new Error(`${label} timed out`));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer != null) {
            window.clearTimeout(timer);
        }
    }
}

export function useNotebookModule({ adapter, auth, enabled, refreshToken }: UseNotebookModuleParams) {
    void refreshToken;
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [items, setItems] = useState<NotebookItem[]>([]);
    const [viewFilter, setViewFilter] = useState<NotebookViewFilter>("all");
    const [sourceScope, setSourceScope] = useState<NotebookSourceScope>("both");
    const [counts, setCounts] = useState({ all: 0, knowledge: 0, note: 0 });
    const [listState, setListState] = useState<NotebookListState>("loading");
    const [listError, setListError] = useState<string | null>(null);
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [editorTitle, setEditorTitle] = useState("");
    const [editorContent, setEditorContent] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [isCreatingDraft, setIsCreatingDraft] = useState(false);
    const [draftFiles, setDraftFiles] = useState<NotebookItemFile[]>([]);
    const [actionBusy, setActionBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [listRefreshing, setListRefreshing] = useState(false);
    const loadSeqRef = useRef(0);
    const syncRunRef = useRef<Promise<void> | null>(null);
    const lastSyncAtRef = useRef(0);
    const draftLockRef = useRef(false);
    const viewFilterRef = useRef<NotebookViewFilter>("all");
    const sourceScopeRef = useRef<NotebookSourceScope>("both");
    const listCacheRef = useRef<Map<string, { items: NotebookItem[]; nextCursor: string | null }>>(new Map());
    const authSignatureRef = useRef<string | null>(null);
    const coldStartSyncRef = useRef<string | null>(null);
    const [chunkSettings, setChunkSettings] = useState<ChunkSettings>({ ...defaultChunkSettings });

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSearch(search.trim());
        }, 250);
        return () => window.clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        draftLockRef.current = isCreatingDraft;
    }, [isCreatingDraft]);

    useEffect(() => {
        viewFilterRef.current = viewFilter;
        sourceScopeRef.current = sourceScope;
    }, [viewFilter, sourceScope]);

    useEffect(() => {
        const nextAuthSignature = auth?.apiBaseUrl && auth?.matrixUserId
            ? `${auth.apiBaseUrl}::${auth.matrixUserId}`
            : null;
        authSignatureRef.current = nextAuthSignature;

        listCacheRef.current.clear();
        loadSeqRef.current += 1;
        syncRunRef.current = null;
        lastSyncAtRef.current = 0;
        setItems([]);
        setCounts({ all: 0, knowledge: 0, note: 0 });
        setListError(null);
        setActionError(null);
        setListRefreshing(false);
        setSelectedItemId(null);
        setEditorTitle("");
        setEditorContent("");
        setIsEditing(false);
        setNextCursor(null);
        setLoadingMore(false);
        setIsCreatingDraft(false);
        setDraftFiles([]);
        coldStartSyncRef.current = null;
    }, [auth?.matrixUserId, auth?.apiBaseUrl, enabled]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );

    const selectItem = useCallback((itemId: string) => {
        const next = items.find((item) => item.id === itemId) ?? null;
        setIsCreatingDraft(false);
        setSelectedItemId(next?.id ?? null);
        setEditorTitle(next?.title ?? "");
        setEditorContent(next?.contentMarkdown ?? "");
        setIsEditing(false);
        setDraftFiles([]);
    }, [items]);

    const applySelection = useCallback((nextItems: NotebookItem[], preferredId?: string | null) => {
        if (draftLockRef.current) return;
        const nextSelected = preferredId ?? selectedItemId;
        const foundInAll = nextItems.find((item) => item.id === nextSelected);
        const fallback = foundInAll ?? nextItems[0] ?? null;
        setSelectedItemId(fallback?.id ?? null);
        setEditorTitle(fallback?.title ?? "");
        setEditorContent(fallback?.contentMarkdown ?? "");
        setIsEditing(false);
    }, [selectedItemId]);

    const invalidateListCache = useCallback(async () => {
        listCacheRef.current.clear();
        await clearNotebookListCache(auth);
    }, [auth]);

    const persistSnapshot = useCallback(async (nextItems: NotebookItem[]) => {
        if (!auth) return;
        const snapshot = { items: nextItems, nextCursor: null as string | null };
        listCacheRef.current.set(NOTEBOOK_SNAPSHOT_CACHE_KEY, snapshot);
        await saveNotebookListCache(auth, NOTEBOOK_SNAPSHOT_CACHE_KEY, snapshot);
    }, [auth]);

    const applySnapshotToView = useCallback((snapshotItems: NotebookItem[], preferredId?: string | null) => {
        const visibleCache = deriveItemsFromAllCache(
            { items: snapshotItems, nextCursor: null },
            viewFilterRef.current,
            sourceScopeRef.current,
            debouncedSearch,
        ) ?? { items: [], nextCursor: null };

        setItems(visibleCache.items);
        setNextCursor(null);
        setCounts(deriveCountsFromAllCache(
            { items: snapshotItems, nextCursor: null },
            sourceScopeRef.current,
            debouncedSearch,
        ));
        if (draftLockRef.current) return;
        if (visibleCache.items.length === 0) {
            setListState(snapshotItems.length === 0 ? "empty" : "ready");
            setSelectedItemId(null);
            setEditorTitle("");
            setEditorContent("");
            setIsEditing(false);
            return;
        }
        setListState("ready");
        applySelection(visibleCache.items, preferredId);
    }, [applySelection, debouncedSearch]);

    const upsertPendingMutation = useCallback((mutation: NotebookPendingItemMutation) => {
        if (!auth) return;
        const current = loadNotebookPendingMutations(auth);
        const next = current.filter((entry) => entry.itemId !== mutation.itemId);
        next.push(mutation);
        saveNotebookPendingMutations(auth, next);
    }, [auth]);

    const replaceSnapshotItem = useCallback(async (
        updater: (currentItems: NotebookItem[]) => { items: NotebookItem[]; preferredId?: string | null },
    ) => {
        if (!auth) return;
        const currentSnapshot = listCacheRef.current.get(NOTEBOOK_SNAPSHOT_CACHE_KEY)
            ?? await loadNotebookListCache(auth, NOTEBOOK_SNAPSHOT_CACHE_KEY)
            ?? { items: [], nextCursor: null };
        const nextState = updater(currentSnapshot.items);
        await persistSnapshot(nextState.items);
        applySnapshotToView(nextState.items, nextState.preferredId);
    }, [applySnapshotToView, auth, persistSnapshot]);

    const applyCachedItems = useCallback(async () => {
        if (!enabled || !auth) {
            setItems([]);
            setCounts({ all: 0, knowledge: 0, note: 0 });
            setListState("empty");
            setListError(null);
            setNextCursor(null);
            setLoadingMore(false);
            setListRefreshing(false);
            setIsCreatingDraft(false);
            setSelectedItemId(null);
            setEditorTitle("");
            setEditorContent("");
            setIsEditing(false);
            return;
        }
        const snapshotCache = listCacheRef.current.get(NOTEBOOK_SNAPSHOT_CACHE_KEY)
            ?? peekNotebookListCache(auth, NOTEBOOK_SNAPSHOT_CACHE_KEY)
            ?? await loadNotebookListCache(auth, NOTEBOOK_SNAPSHOT_CACHE_KEY)
            ?? null;

        if (snapshotCache && !listCacheRef.current.has(NOTEBOOK_SNAPSHOT_CACHE_KEY)) {
            listCacheRef.current.set(NOTEBOOK_SNAPSHOT_CACHE_KEY, snapshotCache);
        }

        const visibleCache = deriveItemsFromAllCache(snapshotCache, viewFilter, sourceScope, debouncedSearch);
        if (visibleCache) {
            setItems(visibleCache.items);
            setNextCursor(null);
            setCounts(deriveCountsFromAllCache(snapshotCache, sourceScope, debouncedSearch));
            if (draftLockRef.current) return;
            if (visibleCache.items.length === 0) {
                setListState((snapshotCache?.items.length ?? 0) === 0 ? "empty" : "ready");
                setSelectedItemId(null);
                setEditorTitle("");
                setEditorContent("");
                setIsEditing(false);
            } else {
                setListState("ready");
                applySelection(visibleCache.items);
            }
            return;
        }

        if (!snapshotCache) {
            setCounts({ all: 0, knowledge: 0, note: 0 });
            setItems([]);
            setNextCursor(null);
            setListState("empty");
        }
    }, [applySelection, auth, debouncedSearch, enabled, sourceScope, viewFilter]);

    const fetchSnapshotItems = useCallback(async () => {
        if (!auth) {
            return { items: [] as NotebookItem[], nextCursor: null as string | null };
        }

        const mergedItems: NotebookItem[] = [];
        const seenIds = new Set<string>();
        const seenCursors = new Set<string | null>([null]);
        let cursor: string | null = null;
        let pageCount = 0;

        for (;;) {
            pageCount += 1;
            if (pageCount > NOTEBOOK_SYNC_MAX_PAGES) {
                throw new Error("Notebook sync exceeded page limit");
            }
            const page = await adapter.listItemsPage(auth, {
                keyword: "",
                filter: "all",
                scope: "both",
                limit: NOTEBOOK_SYNC_PAGE_SIZE,
                cursor: cursor ?? undefined,
            });

            for (const item of page.items) {
                if (seenIds.has(item.id)) continue;
                seenIds.add(item.id);
                mergedItems.push(item);
            }

            if (!page.nextCursor) {
                return { items: mergedItems, nextCursor: null };
            }
            if (seenCursors.has(page.nextCursor)) {
                throw new Error("Notebook sync cursor loop detected");
            }

            seenCursors.add(page.nextCursor);
            cursor = page.nextCursor;
        }
    }, [adapter, auth]);

    const syncPendingMutations = useCallback(async () => {
        if (!auth) return [] as NotebookPendingItemMutation[];

        const pendingMutations = loadNotebookPendingMutations(auth);
        if (pendingMutations.length === 0) {
            return [] as NotebookPendingItemMutation[];
        }

        const initialSnapshot = await fetchSnapshotItems();
        const serverMap = new Map(initialSnapshot.items.map((item) => [item.id, item]));
        const remaining: NotebookPendingItemMutation[] = [];

        for (const mutation of pendingMutations) {
            try {
                const localTimestamp = Date.parse(mutation.localModifiedAt || "") || 0;
                const serverItem = serverMap.get(mutation.itemId) ?? null;
                const serverTimestamp = Date.parse(serverItem?.updatedAt || "") || 0;

                if (mutation.operation === "create") {
                    const created = await adapter.createItem(auth, {
                        title: String(mutation.payload.title || "Untitled note"),
                        contentMarkdown: String(mutation.payload.contentMarkdown || ""),
                        isIndexable: Boolean(mutation.payload.isIndexable),
                        itemType: "text",
                    });
                    serverMap.set(created.id, created);
                    continue;
                }

                if (mutation.operation === "update") {
                    if (serverItem && serverTimestamp > localTimestamp) {
                        continue;
                    }

                    if (!serverItem) {
                        const recreated = await adapter.createItem(auth, {
                            title: String(mutation.payload.title || "Recovered note"),
                            contentMarkdown: String(mutation.payload.contentMarkdown || ""),
                            isIndexable: Boolean(mutation.payload.isIndexable),
                            itemType: "text",
                        });
                        serverMap.set(recreated.id, recreated);
                        continue;
                    }

                    const updated = await adapter.updateItem(auth, mutation.itemId, {
                        title: typeof mutation.payload.title === "string" ? mutation.payload.title : undefined,
                        contentMarkdown: typeof mutation.payload.contentMarkdown === "string"
                            ? mutation.payload.contentMarkdown
                            : undefined,
                        isIndexable: typeof mutation.payload.isIndexable === "boolean"
                            ? mutation.payload.isIndexable
                            : undefined,
                    });
                    serverMap.set(updated.id, updated);
                    continue;
                }

                if (mutation.operation === "delete") {
                    if (!serverItem) {
                        continue;
                    }
                    if (serverTimestamp > localTimestamp) {
                        continue;
                    }
                    await adapter.deleteItem(auth, mutation.itemId);
                    serverMap.delete(mutation.itemId);
                    continue;
                }
            } catch (error) {
                remaining.push(mutation);
                console.error("Notebook pending mutation sync failed", {
                    mutation,
                    error,
                    errorMessage: describeNotebookError(error),
                });
            }
        }

        saveNotebookPendingMutations(auth, remaining);
        return remaining;
    }, [adapter, auth, fetchSnapshotItems]);

    const runSyncItems = useCallback(async (options?: { showIndicator?: boolean }) => {
        if (!enabled || !auth) return;
        const currentViewFilter = viewFilterRef.current;
        const currentSourceScope = sourceScopeRef.current;
        const currentCached = listCacheRef.current.get(NOTEBOOK_SNAPSHOT_CACHE_KEY)
            ?? peekNotebookListCache(auth, NOTEBOOK_SNAPSHOT_CACHE_KEY)
            ?? null;
        const seq = ++loadSeqRef.current;
        setListError(null);
        if (options?.showIndicator) {
            setListRefreshing(true);
        }
        try {
            const remainingPending = await withTimeout(
                syncPendingMutations(),
                NOTEBOOK_SYNC_TIMEOUT_MS,
                "Notebook pending sync",
            );
            const page = await withTimeout(
                fetchSnapshotItems(),
                NOTEBOOK_SYNC_TIMEOUT_MS,
                "Notebook snapshot sync",
            );
            const rows = [...page.items];
            if (remainingPending.length > 0) {
                const localSnapshot = listCacheRef.current.get(NOTEBOOK_SNAPSHOT_CACHE_KEY)
                    ?? await loadNotebookListCache(auth, NOTEBOOK_SNAPSHOT_CACHE_KEY)
                    ?? { items: [], nextCursor: null };
                const localMap = new Map(localSnapshot.items.map((item) => [item.id, item]));
                const rowMap = new Map(rows.map((item) => [item.id, item]));
                for (const mutation of remainingPending) {
                    if (mutation.operation === "delete") {
                        rowMap.delete(mutation.itemId);
                        continue;
                    }
                    const localItem = localMap.get(mutation.itemId);
                    if (localItem) {
                        rowMap.set(localItem.id, localItem);
                    }
                }
                rows.splice(0, rows.length, ...Array.from(rowMap.values()));
            }
            if (seq !== loadSeqRef.current) return;
            const allCache = { items: rows, nextCursor: page.nextCursor };
            await clearNotebookListCache(auth);
            listCacheRef.current.clear();
            listCacheRef.current.set(NOTEBOOK_SNAPSHOT_CACHE_KEY, allCache);
            void saveNotebookListCache(auth, NOTEBOOK_SNAPSHOT_CACHE_KEY, allCache);
            setCounts(deriveCountsFromAllCache(allCache, currentSourceScope, debouncedSearch));

            const nextCache = deriveItemsFromAllCache(allCache, currentViewFilter, currentSourceScope, debouncedSearch) ?? {
                items: [],
                nextCursor: null,
            };

            setItems(nextCache.items);
            setNextCursor(null);
            if (remainingPending.length === 0) {
                setActionError(null);
            } else {
                setActionError("仍有本地修改待同步，请再试一次。");
            }
            if (draftLockRef.current) return;
            if (nextCache.items.length === 0) {
                setListState(allCache.items.length === 0 ? "empty" : "ready");
                setSelectedItemId(null);
                setEditorTitle("");
                setEditorContent("");
                setIsEditing(false);
                return;
            }
            setListState("ready");
            applySelection(nextCache.items);
        } catch (error) {
            if (seq !== loadSeqRef.current) return;
            const errorMessage = describeNotebookError(error);
            console.error("Notebook list sync failed", {
                error,
                errorMessage,
                authMatrixUserId: auth?.matrixUserId ?? null,
                authApiBaseUrl: auth?.apiBaseUrl ?? null,
                filter: currentViewFilter,
                sourceScope: currentSourceScope,
                keyword: debouncedSearch,
            });
            if (!currentCached) {
                setItems([]);
                setCounts({ all: 0, knowledge: 0, note: 0 });
                setListState("error");
            }
            setListError(errorMessage);
            if (options?.showIndicator) {
                setActionError(`同步云端失败：${errorMessage}`);
            }
        } finally {
            if (options?.showIndicator) {
                setListRefreshing(false);
            }
        }
    }, [applySelection, auth, debouncedSearch, enabled, fetchSnapshotItems, syncPendingMutations]);

    const syncItems = useCallback(async (options?: { force?: boolean; showIndicator?: boolean }) => {
        if (!enabled || !auth) return;
        const force = Boolean(options?.force);
        const now = Date.now();
        if (!force && (now - lastSyncAtRef.current) < NOTEBOOK_SYNC_COOLDOWN_MS) {
            return;
        }
        if (syncRunRef.current) {
            if (!force) return syncRunRef.current;
            await syncRunRef.current;
        }
        const nextRun = runSyncItems({ showIndicator: options?.showIndicator }).finally(() => {
            if (syncRunRef.current === nextRun) {
                syncRunRef.current = null;
            }
            lastSyncAtRef.current = Date.now();
        });
        syncRunRef.current = nextRun;
        return nextRun;
    }, [auth, enabled, runSyncItems]);

    useEffect(() => {
        if (!enabled || !auth || isOfflineEnvironment()) return;
        const authSignature = auth.apiBaseUrl && auth.matrixUserId
            ? `${auth.apiBaseUrl}::${auth.matrixUserId}`
            : null;
        if (!authSignature || coldStartSyncRef.current === authSignature) return;

        const snapshotCache = listCacheRef.current.get(NOTEBOOK_SNAPSHOT_CACHE_KEY)
            ?? peekNotebookListCache(auth, NOTEBOOK_SNAPSHOT_CACHE_KEY);
        const pendingMutations = loadNotebookPendingMutations(auth);
        if (snapshotCache || pendingMutations.length > 0) {
            return;
        }

        coldStartSyncRef.current = authSignature;
        void syncItems({ force: true });
    }, [auth, enabled, syncItems]);

    useEffect(() => {
        void applyCachedItems();
    }, [applyCachedItems]);

    const loadMore = useCallback(async () => {
        if (!enabled || !auth || !nextCursor || loadingMore) return;
        setLoadingMore(true);
        setActionError(null);
        try {
            const page = await adapter.listItemsPage(auth, {
                keyword: debouncedSearch,
                filter: viewFilter,
                scope: sourceScope,
                cursor: nextCursor,
                limit: 30,
            });
            const cacheKey = `${viewFilter}:${sourceScope}:${debouncedSearch}`;
            setItems((prev) => {
                const map = new Map(prev.map((item) => [item.id, item]));
                page.items.forEach((item) => map.set(item.id, item));
                const merged = Array.from(map.values());
                listCacheRef.current.set(cacheKey, { items: merged, nextCursor: page.nextCursor });
                void saveNotebookListCache(auth, cacheKey, { items: merged, nextCursor: page.nextCursor });
                return merged;
            });
            setNextCursor(page.nextCursor);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to load more notebook items");
        } finally {
            setLoadingMore(false);
        }
    }, [adapter, auth, debouncedSearch, enabled, loadingMore, nextCursor, sourceScope, viewFilter]);

    useEffect(() => {
        applySelection(items);
        // only react to filter switch; avoid interrupting edit mode on polling refresh
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewFilter]);

    const parsedView = useNotebookParsedView({
        adapter,
        auth,
        enabled,
        selectedItemId,
        selectedItemUpdatedAt: items.find((item) => item.id === selectedItemId)?.updatedAt ?? null,
        selectedItemIndexStatus: items.find((item) => item.id === selectedItemId)?.indexStatus ?? null,
    });

    useEffect(() => {
        if (!enabled || !auth) return undefined;
        const timer = window.setInterval(() => {
            const targets = items.filter((item) =>
                !item.id.startsWith("local:")
                && (item.indexStatus === "pending" || item.indexStatus === "running"),
            );
            if (targets.length === 0) return;
            void Promise.all(
                targets.map(async (item) => {
                    const status = await adapter.getIndexStatus(auth, item.id);
                    return { ...item, indexStatus: status.indexStatus, indexError: status.indexError };
                }),
            ).then((updated) => {
                setItems((prev) => {
                    const updateMap = new Map(updated.map((item) => [item.id, item]));
                    return prev.map((item) => updateMap.get(item.id) ?? item);
                });
            }).catch(() => {
                // ignore polling failures
            });
        }, 3000);
        return () => window.clearInterval(timer);
    }, [adapter, auth, enabled, items]);

    const saveOfflineItem = useCallback(async (params: {
        itemId?: string | null;
        title: string;
        contentMarkdown: string;
        isIndexable: boolean;
    }) => {
        if (!auth) return null;
        const nowIso = new Date().toISOString();
        const localId = params.itemId || `local:note:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
        const previousItem = items.find((item) => item.id === localId) ?? null;
        const nextItem: NotebookItem = {
            id: localId,
            title: params.title,
            contentMarkdown: params.contentMarkdown,
            isIndexable: params.isIndexable,
            itemType: previousItem?.itemType ?? "text",
            indexStatus: params.isIndexable ? "success" : "skipped",
            indexError: null,
            latestIndexJobId: previousItem?.latestIndexJobId ?? null,
            updatedAt: nowIso,
            createdAt: previousItem?.createdAt ?? nowIso,
            matrixMediaName: previousItem?.matrixMediaName ?? null,
            files: previousItem?.files ?? [],
            sourceScope: "personal",
            sourceFileName: previousItem?.sourceFileName ?? null,
            readOnly: false,
        };

        await replaceSnapshotItem((currentItems) => {
            const exists = currentItems.some((item) => item.id === localId);
            const nextItems = exists
                ? currentItems.map((item) => (item.id === localId ? nextItem : item))
                : [nextItem, ...currentItems];
            return { items: nextItems, preferredId: localId };
        });

        upsertPendingMutation({
            itemId: localId,
            operation: previousItem ? "update" : "create",
            localModifiedAt: nowIso,
            baseServerUpdatedAt: previousItem?.updatedAt ?? null,
            payload: {
                title: params.title,
                contentMarkdown: params.contentMarkdown,
                isIndexable: params.isIndexable,
            },
        });

        setSelectedItemId(localId);
        setEditorTitle(params.title);
        setEditorContent(params.contentMarkdown);
        setDraftFiles([]);
        setIsCreatingDraft(false);
        setIsEditing(false);
        setActionError("已保存到本地，待手动同步云端。");
        return nextItem;
    }, [auth, items, replaceSnapshotItem, upsertPendingMutation]);

    const deleteOfflineItem = useCallback(async (itemId: string) => {
        if (!auth) return;
        const target = items.find((item) => item.id === itemId) ?? null;
        if (!target) return;
        const nowIso = new Date().toISOString();
        await replaceSnapshotItem((currentItems) => ({
            items: currentItems.filter((item) => item.id !== itemId),
            preferredId: null,
        }));
        upsertPendingMutation({
            itemId,
            operation: "delete",
            localModifiedAt: nowIso,
            baseServerUpdatedAt: target.updatedAt ?? null,
            payload: {},
        });
        setActionError("已在本地删除，待手动同步云端。");
    }, [auth, items, replaceSnapshotItem, upsertPendingMutation]);

    const createItem = useCallback(async () => {
        if (sourceScope === "company") {
            setActionError("MANAGED_BY_PLATFORM：由平台統一管理，不可修改");
            return;
        }
        setActionError(null);
        loadSeqRef.current += 1;
        setIsCreatingDraft(true);
        setDraftFiles([]);
        setSelectedItemId(null);
        setEditorTitle("");
        setEditorContent("");
        setIsEditing(true);
        setListState((prev) => (prev === "loading" ? "ready" : prev));
    }, [sourceScope]);

    const saveItemAs = useCallback(async (isIndexable: boolean) => {
        if (!auth) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const chunkParams: { chunkStrategy?: string; chunkSize?: number; chunkSeparator?: string } = {};
            if (isIndexable && chunkSettings.enabled) {
                chunkParams.chunkStrategy = chunkSettings.strategy;
                chunkParams.chunkSize = chunkSettings.chunkSize;
                if (chunkSettings.strategy === "custom" && chunkSettings.separator) {
                    chunkParams.chunkSeparator = chunkSettings.separator;
                }
            }
            if (isCreatingDraft || !selectedItemId) {
                if (sourceScope === "company") {
                    throw new Error("MANAGED_BY_PLATFORM");
                }
                if (isOfflineEnvironment()) {
                    await saveOfflineItem({
                        title: editorTitle.trim() || "Untitled note",
                        contentMarkdown: editorContent,
                        isIndexable,
                    });
                    return;
                }
                const created = await adapter.createItem(auth, {
                    title: editorTitle.trim() || "Untitled note",
                    contentMarkdown: editorContent,
                    isIndexable,
                    itemType: "text",
                    ...chunkParams,
                });
                let nextCreated = created;
                for (const file of draftFiles) {
                    nextCreated = await adapter.attachFile(auth, nextCreated.id, {
                        matrixMediaMxc: file.matrixMediaMxc,
                        matrixMediaName: file.matrixMediaName || undefined,
                        matrixMediaMime: file.matrixMediaMime || undefined,
                        matrixMediaSize: file.matrixMediaSize || undefined,
                        isIndexable,
                        ...chunkParams,
                    });
                }
                await invalidateListCache();
                const next = [nextCreated, ...items];
                setItems(next);
                setCounts((prev) => ({
                    all: prev.all + 1,
                    knowledge: prev.knowledge + (nextCreated.isIndexable ? 1 : 0),
                    note: prev.note + (nextCreated.isIndexable ? 0 : 1),
                }));
                setSelectedItemId(nextCreated.id);
                setEditorTitle(nextCreated.title);
                setEditorContent(nextCreated.contentMarkdown);
                setIsCreatingDraft(false);
                setDraftFiles([]);
                setIsEditing(false);
                setListState("ready");
                void syncItems({ force: true });
                return;
            }
            if (isOfflineEnvironment()) {
                await saveOfflineItem({
                    itemId: selectedItemId,
                    title: editorTitle,
                    contentMarkdown: editorContent,
                    isIndexable,
                });
                return;
            }
            const updated = await adapter.updateItem(auth, selectedItemId, {
                title: editorTitle,
                contentMarkdown: editorContent,
                isIndexable,
                ...chunkParams,
            });
            let nextUpdated = updated;
            if (isEditing) {
                const previousFiles = selectedItem?.files ?? [];
                const draftFileMap = new Map(draftFiles.map((file) => [file.id, file]));
                const removedFiles = previousFiles.filter((file) => !draftFileMap.has(file.id));
                const addedFiles = draftFiles.filter((file) => !previousFiles.some((existing) => existing.id === file.id));

                for (const file of removedFiles) {
                    nextUpdated = await adapter.removeFile(auth, nextUpdated.id, file.id);
                }
                for (const file of addedFiles) {
                    nextUpdated = await adapter.attachFile(auth, nextUpdated.id, {
                        matrixMediaMxc: file.matrixMediaMxc,
                        matrixMediaName: file.matrixMediaName || undefined,
                        matrixMediaMime: file.matrixMediaMime || undefined,
                        matrixMediaSize: file.matrixMediaSize || undefined,
                        isIndexable,
                        ...chunkParams,
                    });
                }
            }
            await invalidateListCache();
            const prev = items.find((item) => item.id === selectedItemId);
            if (prev && prev.isIndexable !== nextUpdated.isIndexable) {
                setCounts((state) => ({
                    ...state,
                    knowledge: Math.max(0, state.knowledge + (nextUpdated.isIndexable ? 1 : -1)),
                    note: Math.max(0, state.note + (nextUpdated.isIndexable ? -1 : 1)),
                }));
            }
            setItems((prev) => prev.map((item) => (item.id === selectedItemId ? nextUpdated : item)));
            setEditorTitle(nextUpdated.title);
            setEditorContent(nextUpdated.contentMarkdown);
            setDraftFiles([]);
            setIsCreatingDraft(false);
            setIsEditing(false);
            void syncItems({ force: true });
        } catch (error) {
            if (shouldFallbackToOffline(error)) {
                await saveOfflineItem({
                    itemId: isCreatingDraft ? null : selectedItemId,
                    title: editorTitle.trim() || "Untitled note",
                    contentMarkdown: editorContent,
                    isIndexable,
                });
                return;
            }
            setActionError(error instanceof Error ? error.message : "Failed to save note");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, chunkSettings, draftFiles, editorContent, editorTitle, invalidateListCache, isCreatingDraft, isEditing, items, saveOfflineItem, selectedItem, selectedItemId, sourceScope, syncItems]);

    const deleteItem = useCallback(async () => {
        if (!auth || !selectedItemId) return;
        if (selectedItem?.sourceScope === "company" || selectedItem?.readOnly) return;
        setActionBusy(true);
        setActionError(null);
        try {
            if (isOfflineEnvironment()) {
                await deleteOfflineItem(selectedItemId);
                return;
            }
            await adapter.deleteItem(auth, selectedItemId);
            await invalidateListCache();
            const deleted = items.find((item) => item.id === selectedItemId) ?? null;
            const next = items.filter((item) => item.id !== selectedItemId);
            setItems(next);
            if (deleted) {
                setCounts((prev) => ({
                    all: Math.max(0, prev.all - 1),
                    knowledge: Math.max(0, prev.knowledge - (deleted.isIndexable ? 1 : 0)),
                    note: Math.max(0, prev.note - (deleted.isIndexable ? 0 : 1)),
                }));
            }
            if (next.length === 0) {
                setListState("empty");
            }
            applySelection(next);
            void syncItems({ force: true });
        } catch (error) {
            if (shouldFallbackToOffline(error)) {
                await deleteOfflineItem(selectedItemId);
                return;
            }
            setActionError(error instanceof Error ? error.message : "Failed to delete note");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, applySelection, auth, deleteOfflineItem, invalidateListCache, items, selectedItem, selectedItemId, syncItems]);

    const switchItemMode = useCallback(async (isIndexable: boolean) => {
        if (!auth || !selectedItem) return;
        if (selectedItem.sourceScope === "company" || selectedItem.readOnly) return;
        setActionBusy(true);
        setActionError(null);
        try {
            if (isOfflineEnvironment()) {
                await saveOfflineItem({
                    itemId: selectedItem.id,
                    title: selectedItem.title,
                    contentMarkdown: selectedItem.contentMarkdown,
                    isIndexable,
                });
                return;
            }
            const updated = await adapter.updateItem(auth, selectedItem.id, {
                isIndexable,
            });
            await invalidateListCache();
            if (selectedItem.isIndexable !== updated.isIndexable) {
                setCounts((prev) => ({
                    ...prev,
                    knowledge: Math.max(0, prev.knowledge + (updated.isIndexable ? 1 : -1)),
                    note: Math.max(0, prev.note + (updated.isIndexable ? -1 : 1)),
                }));
            }
            setItems((prev) => prev.map((item) => (item.id === selectedItem.id ? updated : item)));
            setEditorTitle(updated.title);
            setEditorContent(updated.contentMarkdown);
            setIsEditing(false);
            void syncItems({ force: true });
        } catch (error) {
            if (shouldFallbackToOffline(error)) {
                await saveOfflineItem({
                    itemId: selectedItem.id,
                    title: selectedItem.title,
                    contentMarkdown: selectedItem.contentMarkdown,
                    isIndexable,
                });
                return;
            }
            setActionError(error instanceof Error ? error.message : "Failed to update notebook type");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, invalidateListCache, saveOfflineItem, selectedItem, syncItems]);

    const retryIndex = useCallback(async () => {
        if (!auth || !selectedItem) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await adapter.retryIndex(auth, selectedItem.id);
            await invalidateListCache();
            setItems((prev) => prev.map((item) => (item.id === selectedItem.id ? updated : item)));
            void syncItems({ force: true });
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to retry index");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, invalidateListCache, selectedItem, syncItems]);

    const { attachFile, removeFile } = useNotebookItemFiles({
        adapter,
        auth,
        selectedItemId,
        isCreatingDraft,
        isEditing,
        draftFiles,
        setDraftFiles,
        setActionBusy,
        setActionError,
        setItems,
        invalidateListCache,
        syncItems,
    });

    const startEdit = useCallback(() => {
        if (!selectedItem) return;
        if (selectedItem.sourceScope === "company" || selectedItem.readOnly) return;
        setEditorTitle(selectedItem.title);
        setEditorContent(selectedItem.contentMarkdown);
        setDraftFiles(selectedItem.files.map((file) => ({ ...file })));
        setActionError(null);
        setIsEditing(true);
    }, [selectedItem]);

    const cancelEdit = useCallback(() => {
        if (isCreatingDraft) {
            setActionError(null);
            setIsCreatingDraft(false);
            setIsEditing(false);
            const fallback = items[0] ?? null;
            setSelectedItemId(fallback?.id ?? null);
            setEditorTitle(fallback?.title ?? "");
            setEditorContent(fallback?.contentMarkdown ?? "");
            setDraftFiles([]);
            return;
        }
        if (!selectedItem) return;
        setEditorTitle(selectedItem.title);
        setEditorContent(selectedItem.contentMarkdown);
        setDraftFiles([]);
        setActionError(null);
        setIsEditing(false);
    }, [isCreatingDraft, items, selectedItem]);

    return {
        search,
        setSearch,
        viewFilter,
        setViewFilter,
        sourceScope,
        setSourceScope,
        counts,
        items,
        allItems: items,
        listState,
        listError,
        selectedItem,
        selectedItemId,
        setSelectedItemId: selectItem,
        editorTitle,
        setEditorTitle,
        editorContent,
        setEditorContent,
        isEditing,
        isCreatingDraft,
        actionBusy,
        actionError,
        listRefreshing,
        hasMore: Boolean(nextCursor),
        loadingMore,
        loadItems: applyCachedItems,
        syncItems,
        loadMore,
        createItem,
        saveItemAs,
        deleteItem,
        switchItemMode,
        retryIndex,
        startEdit,
        cancelEdit,
        attachFile,
        removeFile,
        draftFiles,
        ...parsedView,
        chunkSettings,
        setChunkSettings,
    };
}
