import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotebookAdapter } from "./adapters/types";
import type { NotebookAuthContext, NotebookItem, NotebookItemFile, NotebookListState } from "./types";
import { useNotebookParsedView } from "./hooks/useNotebookParsedView";
import { useNotebookItemFiles } from "./hooks/useNotebookItemFiles";
import { defaultChunkSettings, type ChunkSettings } from "./components/ChunkSettingsPanel";
import { loadNotebookListCache, peekNotebookListCache, saveNotebookListCache } from "./cache";

type UseNotebookModuleParams = {
    adapter: NotebookAdapter;
    auth: NotebookAuthContext | null;
    enabled: boolean;
    refreshToken: number;
};

export type NotebookViewFilter = "all" | "knowledge" | "note";
export type NotebookSourceScope = "personal" | "company" | "both";

function deriveItemsFromAllCache(
    allCache: { items: NotebookItem[]; nextCursor: string | null } | null,
    viewFilter: NotebookViewFilter,
    sourceScope: NotebookSourceScope,
): { items: NotebookItem[]; nextCursor: string | null } | null {
    if (!allCache) return null;
    const filtered = allCache.items.filter((item) => {
        if (sourceScope === "company" && item.sourceScope !== "company") return false;
        if (sourceScope === "personal" && item.sourceScope === "company") return false;
        if (viewFilter === "knowledge" && !item.isIndexable) return false;
        if (viewFilter === "note" && item.isIndexable) return false;
        return true;
    });
    return {
        items: filtered,
        nextCursor: null,
    };
}

export function useNotebookModule({ adapter, auth, enabled, refreshToken }: UseNotebookModuleParams) {
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
    const countsSeqRef = useRef(0);
    const draftLockRef = useRef(false);
    const viewFilterRef = useRef<NotebookViewFilter>("all");
    const sourceScopeRef = useRef<NotebookSourceScope>("both");
    const listCacheRef = useRef<Map<string, { items: NotebookItem[]; nextCursor: string | null }>>(new Map());
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
        listCacheRef.current.clear();
        setNextCursor(null);
        setLoadingMore(false);
        setIsCreatingDraft(false);
        setDraftFiles([]);
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

    const invalidateListCache = useCallback(() => {
        listCacheRef.current.clear();
    }, []);

    const refreshCounts = useCallback(async (keyword: string) => {
        if (!enabled || !auth) {
            setCounts({ all: 0, knowledge: 0, note: 0 });
            return;
        }
        const seq = ++countsSeqRef.current;
        try {
            const [allRows, knowledgeRows, noteRows] = await Promise.all([
                adapter.listItems(auth, { keyword, filter: "all", scope: sourceScope }),
                adapter.listItems(auth, { keyword, filter: "knowledge", scope: sourceScope }),
                adapter.listItems(auth, { keyword, filter: "note", scope: sourceScope }),
            ]);
            if (seq !== countsSeqRef.current) return;
            setCounts({
                all: allRows.length,
                knowledge: knowledgeRows.length,
                note: noteRows.length,
            });
        } catch {
            // keep existing counts on background refresh failure
        }
    }, [adapter, auth, enabled, sourceScope]);

    const applyCachedItems = useCallback(async () => {
        if (!enabled || !auth) {
            setItems([]);
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
        const cacheKey = `${viewFilter}:${sourceScope}:${debouncedSearch}`;
        const allCacheKey = `all:both:${debouncedSearch}`;
        const allFastCached = listCacheRef.current.get(allCacheKey) ?? peekNotebookListCache(auth, allCacheKey) ?? null;
        const derivedFromAll = cacheKey !== allCacheKey
            ? deriveItemsFromAllCache(allFastCached, viewFilter, sourceScope)
            : null;
        const fastCached = listCacheRef.current.get(cacheKey) ?? peekNotebookListCache(auth, cacheKey) ?? derivedFromAll ?? null;
        if (fastCached && !listCacheRef.current.has(cacheKey)) {
            listCacheRef.current.set(cacheKey, fastCached);
        }
        if (fastCached) {
            setItems(fastCached.items);
            setNextCursor(fastCached.nextCursor);
            if (!draftLockRef.current) {
                if (fastCached.items.length === 0) {
                    setListState("empty");
                    setSelectedItemId(null);
                    setEditorTitle("");
                    setEditorContent("");
                    setIsEditing(false);
                } else {
                    setListState("ready");
                    applySelection(fastCached.items);
                }
            }
        }

        const cached = fastCached ?? await loadNotebookListCache(auth, cacheKey) ?? null;
        if (cached && !listCacheRef.current.has(cacheKey)) {
            listCacheRef.current.set(cacheKey, cached);
        }
        if (cached) {
            setItems(cached.items);
            setNextCursor(cached.nextCursor);
            if (draftLockRef.current) return;
            if (cached.items.length === 0) {
                setListState("empty");
                setSelectedItemId(null);
                setEditorTitle("");
                setEditorContent("");
                setIsEditing(false);
            } else {
                setListState("ready");
                applySelection(cached.items);
            }
        }
        if (!cached) {
            setListState("loading");
        }
    }, [applySelection, auth, debouncedSearch, enabled, sourceScope, viewFilter]);

    const syncItems = useCallback(async () => {
        if (!enabled || !auth) return;
        const currentViewFilter = viewFilterRef.current;
        const currentSourceScope = sourceScopeRef.current;
        const cacheKey = `${currentViewFilter}:${currentSourceScope}:${debouncedSearch}`;
        const allCacheKey = `all:both:${debouncedSearch}`;
        const currentCached = listCacheRef.current.get(cacheKey) ?? peekNotebookListCache(auth, cacheKey) ?? null;
        const seq = ++loadSeqRef.current;
        setListError(null);
        setListRefreshing(Boolean(currentCached || items.length > 0));
        try {
            const page = await adapter.listItemsPage(auth, {
                keyword: debouncedSearch,
                filter: "all",
                scope: "both",
                limit: 30,
            });
            const rows = page.items;
            if (seq !== loadSeqRef.current) return;
            const allCache = { items: rows, nextCursor: page.nextCursor };
            listCacheRef.current.set(allCacheKey, allCache);
            void saveNotebookListCache(auth, allCacheKey, allCache);

            const nextCache = deriveItemsFromAllCache(allCache, currentViewFilter, currentSourceScope) ?? allCache;
            listCacheRef.current.set(cacheKey, nextCache);
            void saveNotebookListCache(auth, cacheKey, nextCache);

            setItems(nextCache.items);
            setNextCursor(nextCache.nextCursor);
            if (draftLockRef.current) return;
            if (nextCache.items.length === 0) {
                setListState("empty");
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
            if (!currentCached) {
                setItems([]);
                setCounts({ all: 0, knowledge: 0, note: 0 });
                setListState("error");
            }
            setListError(error instanceof Error ? error.message : "Failed to load notebook items");
        } finally {
            if (seq === loadSeqRef.current) {
                setListRefreshing(false);
            }
        }
    }, [adapter, applySelection, auth, debouncedSearch, enabled, items.length]);

    useEffect(() => {
        void applyCachedItems();
    }, [applyCachedItems]);

    useEffect(() => {
        void syncItems();
    }, [syncItems, refreshToken, debouncedSearch]);

    useEffect(() => {
        if (!enabled || !auth) return;
        void refreshCounts(debouncedSearch);
    }, [auth, debouncedSearch, enabled, refreshCounts]);

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
    });

    useEffect(() => {
        if (!enabled || !auth) return undefined;
        const timer = window.setInterval(() => {
            const targets = items.filter((item) => item.indexStatus === "pending" || item.indexStatus === "running");
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
                invalidateListCache();
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
            invalidateListCache();
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
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to save note");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, chunkSettings, draftFiles, editorContent, editorTitle, invalidateListCache, isCreatingDraft, isEditing, items, selectedItem, selectedItemId, sourceScope]);

    const deleteItem = useCallback(async () => {
        if (!auth || !selectedItemId) return;
        if (selectedItem?.sourceScope === "company" || selectedItem?.readOnly) return;
        setActionBusy(true);
        setActionError(null);
        try {
            await adapter.deleteItem(auth, selectedItemId);
            invalidateListCache();
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
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to delete note");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, applySelection, auth, invalidateListCache, items, selectedItem, selectedItemId]);

    const switchItemMode = useCallback(async (isIndexable: boolean) => {
        if (!auth || !selectedItem) return;
        if (selectedItem.sourceScope === "company" || selectedItem.readOnly) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await adapter.updateItem(auth, selectedItem.id, {
                isIndexable,
            });
            invalidateListCache();
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
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to update notebook type");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, invalidateListCache, selectedItem]);

    const retryIndex = useCallback(async () => {
        if (!auth || !selectedItem) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await adapter.retryIndex(auth, selectedItem.id);
            setItems((prev) => prev.map((item) => (item.id === selectedItem.id ? updated : item)));
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to retry index");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, selectedItem]);

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
