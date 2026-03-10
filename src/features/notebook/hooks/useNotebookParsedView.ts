import { useEffect, useMemo, useRef, useState } from "react";
import type { NotebookAdapter } from "../adapters/types";
import type { NotebookAuthContext, NotebookChunk, NotebookParsedPreview } from "../types";
import { loadNotebookParsedCache, saveNotebookParsedCache } from "../cache";

type UseNotebookParsedViewParams = {
    adapter: NotebookAdapter;
    auth: NotebookAuthContext | null;
    enabled: boolean;
    selectedItemId: string | null;
};

export function useNotebookParsedView({ adapter, auth, enabled, selectedItemId }: UseNotebookParsedViewParams) {
    const canLoad = Boolean(enabled && auth && selectedItemId);
    const requestKey = canLoad ? String(selectedItemId) : null;
    const cacheRef = useRef(new Map<string, {
        preview: NotebookParsedPreview | null;
        chunks: NotebookChunk[];
        chunksTotal: number;
        error: string | null;
    }>());
    const [loadedState, setLoadedState] = useState<{
        key: string | null;
        preview: NotebookParsedPreview | null;
        chunks: NotebookChunk[];
        chunksTotal: number;
        error: string | null;
    }>({
        key: null,
        preview: null,
        chunks: [],
        chunksTotal: 0,
        error: null,
    });

    useEffect(() => {
        cacheRef.current.clear();
        setLoadedState({
            key: null,
            preview: null,
            chunks: [],
            chunksTotal: 0,
            error: null,
        });
    }, [auth?.matrixUserId, auth?.apiBaseUrl]);

    useEffect(() => {
        if (!canLoad || !auth || !selectedItemId) {
            return;
        }
        let alive = true;
        const nextKey = String(selectedItemId);

        void (async () => {
            const cached = cacheRef.current.get(nextKey) ?? await loadNotebookParsedCache(auth, nextKey) ?? null;
            if (!alive) return;
            if (cached) {
                if (!cacheRef.current.has(nextKey)) {
                    cacheRef.current.set(nextKey, cached);
                }
                setLoadedState({
                    key: nextKey,
                    preview: cached.preview,
                    chunks: cached.chunks,
                    chunksTotal: cached.chunksTotal,
                    error: cached.error,
                });
                return;
            }

            return Promise.all([
                adapter.getParsedPreview(auth, selectedItemId),
                adapter.getChunks(auth, selectedItemId),
            ]).then(([preview, chunkPayload]) => {
            if (!alive) return;
            const nextValue = {
                preview,
                chunks: chunkPayload.chunks,
                chunksTotal: chunkPayload.total,
                error: null,
            };
            cacheRef.current.set(nextKey, nextValue);
            void saveNotebookParsedCache(auth, nextKey, nextValue);
            setLoadedState({
                key: nextKey,
                preview,
                chunks: chunkPayload.chunks,
                chunksTotal: chunkPayload.total,
                error: null,
            });
        }).catch((error) => {
            if (!alive) return;
            const nextError = error instanceof Error ? error.message : "Failed to load parsed preview";
            const nextValue = {
                preview: null,
                chunks: [],
                chunksTotal: 0,
                error: nextError,
            };
            cacheRef.current.set(nextKey, nextValue);
            void saveNotebookParsedCache(auth, nextKey, nextValue);
            setLoadedState({
                key: nextKey,
                preview: null,
                chunks: [],
                chunksTotal: 0,
                error: nextError,
            });
            });
        })();
        return () => {
            alive = false;
        };
    }, [adapter, auth, canLoad, selectedItemId]);

    return useMemo(() => ({
        previewBusy: canLoad ? loadedState.key !== requestKey : false,
        previewError: canLoad && loadedState.key === requestKey ? loadedState.error : null,
        parsedPreview: canLoad && loadedState.key === requestKey ? loadedState.preview : null,
        chunks: canLoad && loadedState.key === requestKey ? loadedState.chunks : [],
        chunksTotal: canLoad && loadedState.key === requestKey ? loadedState.chunksTotal : 0,
    }), [canLoad, loadedState, requestKey]);
}
