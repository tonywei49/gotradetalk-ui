import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotebookAdapter } from "./adapters/types";
import type { NotebookAuthContext, NotebookItem, NotebookListState } from "./types";
import { useNotebookParsedView } from "./hooks/useNotebookParsedView";
import { useNotebookItemFiles } from "./hooks/useNotebookItemFiles";
import { defaultChunkSettings, type ChunkSettings } from "./components/ChunkSettingsPanel";

type UseNotebookModuleParams = {
    adapter: NotebookAdapter;
    auth: NotebookAuthContext | null;
    enabled: boolean;
};

export type NotebookViewFilter = "all" | "knowledge" | "note";
export type NotebookSourceScope = "personal" | "company" | "both";

export function useNotebookModule({ adapter, auth, enabled }: UseNotebookModuleParams) {
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
    const [actionBusy, setActionBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const loadSeqRef = useRef(0);
    const countsSeqRef = useRef(0);
    const draftLockRef = useRef(false);
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
        listCacheRef.current.clear();
        setNextCursor(null);
        setLoadingMore(false);
        setIsCreatingDraft(false);
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

    const loadItems = useCallback(async () => {
        if (!enabled || !auth) {
            setItems([]);
            setListState("empty");
            setListError(null);
            setNextCursor(null);
            setLoadingMore(false);
            setIsCreatingDraft(false);
            setSelectedItemId(null);
            setEditorTitle("");
            setEditorContent("");
            setIsEditing(false);
            return;
        }
        const cacheKey = `${viewFilter}:${sourceScope}:${debouncedSearch}`;
        const cached = listCacheRef.current.get(cacheKey) ?? null;
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
        const seq = ++loadSeqRef.current;
        setListError(null);
        if (!cached) {
            setListState("loading");
        }
        try {
            const page = await adapter.listItemsPage(auth, {
                keyword: debouncedSearch,
                filter: viewFilter,
                scope: sourceScope,
                limit: 30,
            });
            const rows = page.items;
            if (seq !== loadSeqRef.current) return;
            listCacheRef.current.set(cacheKey, { items: rows, nextCursor: page.nextCursor });
            setItems(rows);
            setNextCursor(page.nextCursor);
            if (draftLockRef.current) return;
            if (rows.length === 0) {
                setListState("empty");
                setSelectedItemId(null);
                setEditorTitle("");
                setEditorContent("");
                setIsEditing(false);
                return;
            }
            setListState("ready");
            applySelection(rows);
        } catch (error) {
            if (seq !== loadSeqRef.current) return;
            if (!cached) {
                setItems([]);
                setCounts({ all: 0, knowledge: 0, note: 0 });
                setListState("error");
            }
            setListError(error instanceof Error ? error.message : "Failed to load notebook items");
        }
    }, [adapter, applySelection, auth, debouncedSearch, enabled, sourceScope, viewFilter]);

    useEffect(() => {
        void loadItems();
    }, [loadItems]);

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
            if (isCreatingDraft || !selectedItemId) {
                if (sourceScope === "company") {
                    throw new Error("MANAGED_BY_PLATFORM");
                }
                const chunkParams: { chunkStrategy?: string; chunkSize?: number; chunkSeparator?: string } = {};
                if (isIndexable && chunkSettings.enabled) {
                    chunkParams.chunkStrategy = chunkSettings.strategy;
                    chunkParams.chunkSize = chunkSettings.chunkSize;
                    if (chunkSettings.strategy === 'custom' && chunkSettings.separator) {
                        chunkParams.chunkSeparator = chunkSettings.separator;
                    }
                }
                const created = await adapter.createItem(auth, {
                    title: editorTitle.trim() || "Untitled note",
                    contentMarkdown: editorContent,
                    isIndexable,
                    itemType: "text",
                    ...chunkParams,
                });
                invalidateListCache();
                const next = [created, ...items];
                setItems(next);
                setCounts((prev) => ({
                    all: prev.all + 1,
                    knowledge: prev.knowledge + (created.isIndexable ? 1 : 0),
                    note: prev.note + (created.isIndexable ? 0 : 1),
                }));
                setSelectedItemId(created.id);
                setEditorTitle(created.title);
                setEditorContent(created.contentMarkdown);
                setIsCreatingDraft(false);
                setIsEditing(false);
                setListState("ready");
                return;
            }
            const updated = await adapter.updateItem(auth, selectedItemId, {
                title: editorTitle,
                contentMarkdown: editorContent,
                isIndexable,
            });
            invalidateListCache();
            const prev = items.find((item) => item.id === selectedItemId);
            if (prev && prev.isIndexable !== updated.isIndexable) {
                setCounts((state) => ({
                    ...state,
                    knowledge: Math.max(0, state.knowledge + (updated.isIndexable ? 1 : -1)),
                    note: Math.max(0, state.note + (updated.isIndexable ? -1 : 1)),
                }));
            }
            setItems((prev) => prev.map((item) => (item.id === selectedItemId ? updated : item)));
            setEditorTitle(updated.title);
            setEditorContent(updated.contentMarkdown);
            setIsCreatingDraft(false);
            setIsEditing(false);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to save note");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, chunkSettings, editorContent, editorTitle, invalidateListCache, isCreatingDraft, items, selectedItemId, sourceScope]);

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
        setActionBusy,
        setActionError,
        setItems,
    });

    const startEdit = useCallback(() => {
        if (!selectedItem) return;
        if (selectedItem.sourceScope === "company" || selectedItem.readOnly) return;
        setEditorTitle(selectedItem.title);
        setEditorContent(selectedItem.contentMarkdown);
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
            return;
        }
        if (!selectedItem) return;
        setEditorTitle(selectedItem.title);
        setEditorContent(selectedItem.contentMarkdown);
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
        hasMore: Boolean(nextCursor),
        loadingMore,
        loadItems,
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
        ...parsedView,
        chunkSettings,
        setChunkSettings,
    };
}
