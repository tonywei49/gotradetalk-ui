import { useCallback, useEffect, useMemo, useState } from "react";
import type { NotebookAdapter } from "./adapters/types";
import type { NotebookAuthContext, NotebookChunk, NotebookItem, NotebookListState, NotebookParsedPreview } from "./types";

type UseNotebookModuleParams = {
    adapter: NotebookAdapter;
    auth: NotebookAuthContext | null;
    enabled: boolean;
};

export function useNotebookModule({ adapter, auth, enabled }: UseNotebookModuleParams) {
    const [search, setSearch] = useState("");
    const [items, setItems] = useState<NotebookItem[]>([]);
    const [listState, setListState] = useState<NotebookListState>("loading");
    const [listError, setListError] = useState<string | null>(null);
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [editorTitle, setEditorTitle] = useState("");
    const [editorContent, setEditorContent] = useState("");
    const [actionBusy, setActionBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [parsedPreview, setParsedPreview] = useState<NotebookParsedPreview | null>(null);
    const [chunks, setChunks] = useState<NotebookChunk[]>([]);
    const [chunksTotal, setChunksTotal] = useState(0);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );

    const selectItem = useCallback((itemId: string) => {
        const next = items.find((item) => item.id === itemId) ?? null;
        setSelectedItemId(next?.id ?? null);
        setEditorTitle(next?.title ?? "");
        setEditorContent(next?.contentMarkdown ?? "");
    }, [items]);

    const applySelection = useCallback((nextItems: NotebookItem[], preferredId?: string | null) => {
        const nextSelected = preferredId ?? selectedItemId;
        const found = nextItems.find((item) => item.id === nextSelected);
        const fallback = found ?? nextItems[0] ?? null;
        setSelectedItemId(fallback?.id ?? null);
        setEditorTitle(fallback?.title ?? "");
        setEditorContent(fallback?.contentMarkdown ?? "");
    }, [selectedItemId]);

    const loadItems = useCallback(async () => {
        if (!enabled || !auth) {
            setItems([]);
            setListState("empty");
            setListError(null);
            setSelectedItemId(null);
            setEditorTitle("");
            setEditorContent("");
            return;
        }
        setListError(null);
        setListState("loading");
        try {
            const rows = await adapter.listItems(auth, { keyword: search });
            setItems(rows);
            if (rows.length === 0) {
                setListState("empty");
                setSelectedItemId(null);
                setEditorTitle("");
                setEditorContent("");
                return;
            }
            setListState("ready");
            applySelection(rows);
        } catch (error) {
            setItems([]);
            setListState("error");
            setListError(error instanceof Error ? error.message : "Failed to load notebook items");
        }
    }, [adapter, applySelection, auth, enabled, search]);

    useEffect(() => {
        void loadItems();
    }, [loadItems]);

    useEffect(() => {
        if (!enabled || !auth || !selectedItemId) {
            setParsedPreview(null);
            setChunks([]);
            setChunksTotal(0);
            setPreviewError(null);
            return;
        }
        let alive = true;
        setPreviewBusy(true);
        setPreviewError(null);
        void Promise.all([
            adapter.getParsedPreview(auth, selectedItemId),
            adapter.getChunks(auth, selectedItemId),
        ]).then(([preview, chunkPayload]) => {
            if (!alive) return;
            setParsedPreview(preview);
            setChunks(chunkPayload.chunks);
            setChunksTotal(chunkPayload.total);
        }).catch((error) => {
            if (!alive) return;
            setParsedPreview(null);
            setChunks([]);
            setChunksTotal(0);
            setPreviewError(error instanceof Error ? error.message : "Failed to load parsed preview");
        }).finally(() => {
            if (!alive) return;
            setPreviewBusy(false);
        });
        return () => {
            alive = false;
        };
    }, [adapter, auth, enabled, selectedItemId]);

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
                itemType: "text",
            });
            const next = [created, ...items];
            setItems(next);
            setListState("ready");
            applySelection(next, created.id);
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to create note");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, applySelection, auth, items]);

    const saveItem = useCallback(async () => {
        if (!auth || !selectedItemId) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await adapter.updateItem(auth, selectedItemId, {
                title: editorTitle,
                contentMarkdown: editorContent,
            });
            setItems((prev) => prev.map((item) => (item.id === selectedItemId ? updated : item)));
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

    const attachFile = useCallback(async (input: {
        matrixMediaMxc: string;
        matrixMediaName?: string;
        matrixMediaMime?: string;
        matrixMediaSize?: number;
        isIndexable?: boolean;
    }) => {
        if (!auth || !selectedItemId) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await adapter.attachFile(auth, selectedItemId, input);
            setItems((prev) => prev.map((item) => (item.id === selectedItemId ? updated : item)));
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to attach file");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, selectedItemId]);

    const removeFile = useCallback(async (fileId: string) => {
        if (!auth || !selectedItemId) return;
        setActionBusy(true);
        setActionError(null);
        try {
            const updated = await adapter.removeFile(auth, selectedItemId, fileId);
            setItems((prev) => prev.map((item) => (item.id === selectedItemId ? updated : item)));
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to remove file");
        } finally {
            setActionBusy(false);
        }
    }, [adapter, auth, selectedItemId]);

    return {
        search,
        setSearch,
        items,
        listState,
        listError,
        selectedItem,
        selectedItemId,
        setSelectedItemId: selectItem,
        editorTitle,
        setEditorTitle,
        editorContent,
        setEditorContent,
        actionBusy,
        actionError,
        loadItems,
        createItem,
        saveItem,
        deleteItem,
        attachFile,
        removeFile,
        previewBusy,
        previewError,
        parsedPreview,
        chunks,
        chunksTotal,
    };
}
