import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotebookAdapter } from "./adapters/types";
import type { NotebookAuthContext, NotebookItem, NotebookListState } from "./types";
import { useNotebookParsedView } from "./hooks/useNotebookParsedView";
import { useNotebookItemFiles } from "./hooks/useNotebookItemFiles";

type UseNotebookModuleParams = {
    adapter: NotebookAdapter;
    auth: NotebookAuthContext | null;
    enabled: boolean;
};

export type NotebookViewFilter = "all" | "knowledge" | "note";

export function useNotebookModule({ adapter, auth, enabled }: UseNotebookModuleParams) {
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [items, setItems] = useState<NotebookItem[]>([]);
    const [viewFilter, setViewFilter] = useState<NotebookViewFilter>("all");
    const [counts, setCounts] = useState({ all: 0, knowledge: 0, note: 0 });
    const [listState, setListState] = useState<NotebookListState>("loading");
    const [listError, setListError] = useState<string | null>(null);
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [editorTitle, setEditorTitle] = useState("");
    const [editorContent, setEditorContent] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [actionBusy, setActionBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const loadSeqRef = useRef(0);
    const countsSeqRef = useRef(0);
    const listCacheRef = useRef<Map<string, NotebookItem[]>>(new Map());

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSearch(search.trim());
        }, 250);
        return () => window.clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        listCacheRef.current.clear();
    }, [auth?.matrixUserId, auth?.apiBaseUrl, enabled]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );

    const selectItem = useCallback((itemId: string) => {
        const next = items.find((item) => item.id === itemId) ?? null;
        setSelectedItemId(next?.id ?? null);
        setEditorTitle(next?.title ?? "");
        setEditorContent(next?.contentMarkdown ?? "");
        setIsEditing(false);
    }, [items]);

    const applySelection = useCallback((nextItems: NotebookItem[], preferredId?: string | null) => {
        const nextSelected = preferredId ?? selectedItemId;
        const foundInAll = nextItems.find((item) => item.id === nextSelected);
        const fallback = foundInAll ?? nextItems[0] ?? null;
        setSelectedItemId(fallback?.id ?? null);
        setEditorTitle(fallback?.title ?? "");
        setEditorContent(fallback?.contentMarkdown ?? "");
        setIsEditing(false);
    }, [selectedItemId]);

    const refreshCounts = useCallback(async (keyword: string) => {
        if (!enabled || !auth) {
            setCounts({ all: 0, knowledge: 0, note: 0 });
            return;
        }
        const seq = ++countsSeqRef.current;
        try {
            const [allRows, knowledgeRows, noteRows] = await Promise.all([
                adapter.listItems(auth, { keyword, filter: "all" }),
                adapter.listItems(auth, { keyword, filter: "knowledge" }),
                adapter.listItems(auth, { keyword, filter: "note" }),
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
    }, [adapter, auth, enabled]);

    const loadItems = useCallback(async () => {
        if (!enabled || !auth) {
            setItems([]);
            setListState("empty");
            setListError(null);
            setSelectedItemId(null);
            setEditorTitle("");
            setEditorContent("");
            setIsEditing(false);
            return;
        }
        const cacheKey = `${viewFilter}:${debouncedSearch}`;
        const cachedRows = listCacheRef.current.get(cacheKey) ?? null;
        if (cachedRows) {
            setItems(cachedRows);
            if (cachedRows.length === 0) {
                setListState("empty");
                setSelectedItemId(null);
                setEditorTitle("");
                setEditorContent("");
                setIsEditing(false);
            } else {
                setListState("ready");
                applySelection(cachedRows);
            }
        }
        const seq = ++loadSeqRef.current;
        setListError(null);
        if (!cachedRows) {
            setListState("loading");
        }
        try {
            const rows = await adapter.listItems(auth, { keyword: debouncedSearch, filter: viewFilter });
            if (seq !== loadSeqRef.current) return;
            listCacheRef.current.set(cacheKey, rows);
            setItems(rows);
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
            if (!cachedRows) {
                setItems([]);
                setCounts({ all: 0, knowledge: 0, note: 0 });
                setListState("error");
            }
            setListError(error instanceof Error ? error.message : "Failed to load notebook items");
        }
    }, [adapter, applySelection, auth, debouncedSearch, enabled, viewFilter]);

    useEffect(() => {
        void loadItems();
    }, [loadItems]);

    useEffect(() => {
        if (!enabled || !auth) return;
        void refreshCounts(debouncedSearch);
    }, [auth, debouncedSearch, enabled, refreshCounts]);

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
        if (!auth) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const created = await adapter.createItem(auth, {
                title: "Untitled note",
                contentMarkdown: "",
                isIndexable: false,
                itemType: "text",
            });
            const next = [created, ...items];
            setItems(next);
            setListState("ready");
            setSelectedItemId(created.id);
            setEditorTitle(created.title);
            setEditorContent(created.contentMarkdown);
            setIsEditing(true);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to create note");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, items]);

    const saveItemAs = useCallback(async (isIndexable: boolean) => {
        if (!auth || !selectedItemId) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await adapter.updateItem(auth, selectedItemId, {
                title: editorTitle,
                contentMarkdown: editorContent,
                isIndexable,
            });
            setItems((prev) => prev.map((item) => (item.id === selectedItemId ? updated : item)));
            setEditorTitle(updated.title);
            setEditorContent(updated.contentMarkdown);
            setIsEditing(false);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to save note");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, editorContent, editorTitle, selectedItemId]);

    const deleteItem = useCallback(async () => {
        if (!auth || !selectedItemId) return;
        setActionBusy(true);
        setActionError(null);
        try {
            await adapter.deleteItem(auth, selectedItemId);
            const next = items.filter((item) => item.id !== selectedItemId);
            setItems(next);
            if (next.length === 0) {
                setListState("empty");
            }
            applySelection(next);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to delete note");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, applySelection, auth, items, selectedItemId]);

    const switchItemMode = useCallback(async (isIndexable: boolean) => {
        if (!auth || !selectedItem) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await adapter.updateItem(auth, selectedItem.id, {
                isIndexable,
            });
            setItems((prev) => prev.map((item) => (item.id === selectedItem.id ? updated : item)));
            setEditorTitle(updated.title);
            setEditorContent(updated.contentMarkdown);
            setIsEditing(false);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to update notebook type");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, selectedItem]);

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
        setEditorTitle(selectedItem.title);
        setEditorContent(selectedItem.contentMarkdown);
        setActionError(null);
        setIsEditing(true);
    }, [selectedItem]);

    const cancelEdit = useCallback(() => {
        if (!selectedItem) return;
        setEditorTitle(selectedItem.title);
        setEditorContent(selectedItem.contentMarkdown);
        setActionError(null);
        setIsEditing(false);
    }, [selectedItem]);

    return {
        search,
        setSearch,
        viewFilter,
        setViewFilter,
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
        actionBusy,
        actionError,
        loadItems,
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
    };
}
