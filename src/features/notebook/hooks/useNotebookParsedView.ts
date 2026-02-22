import { useEffect, useMemo, useState } from "react";
import type { NotebookAdapter } from "../adapters/types";
import type { NotebookAuthContext, NotebookChunk, NotebookParsedPreview } from "../types";

type UseNotebookParsedViewParams = {
    adapter: NotebookAdapter;
    auth: NotebookAuthContext | null;
    enabled: boolean;
    selectedItemId: string | null;
};

export function useNotebookParsedView({ adapter, auth, enabled, selectedItemId }: UseNotebookParsedViewParams) {
    const canLoad = Boolean(enabled && auth && selectedItemId);
    const requestKey = canLoad ? String(selectedItemId) : null;
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
        if (!canLoad || !auth || !selectedItemId) {
            return;
        }
        let alive = true;
        void Promise.all([
            adapter.getParsedPreview(auth, selectedItemId),
            adapter.getChunks(auth, selectedItemId),
        ]).then(([preview, chunkPayload]) => {
            if (!alive) return;
            setLoadedState({
                key: String(selectedItemId),
                preview,
                chunks: chunkPayload.chunks,
                chunksTotal: chunkPayload.total,
                error: null,
            });
        }).catch((error) => {
            if (!alive) return;
            setLoadedState({
                key: String(selectedItemId),
                preview: null,
                chunks: [],
                chunksTotal: 0,
                error: error instanceof Error ? error.message : "Failed to load parsed preview",
            });
        });
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
