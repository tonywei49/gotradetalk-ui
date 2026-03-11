import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { NotebookAdapter } from "../adapters/types";
import type { NotebookAuthContext, NotebookItem, NotebookItemFile } from "../types";

type UseNotebookItemFilesParams = {
    adapter: NotebookAdapter;
    auth: NotebookAuthContext | null;
    selectedItemId: string | null;
    isCreatingDraft: boolean;
    isEditing: boolean;
    draftFiles: NotebookItemFile[];
    setDraftFiles: Dispatch<SetStateAction<NotebookItemFile[]>>;
    setActionBusy: (busy: boolean) => void;
    setActionError: (error: string | null) => void;
    setItems: Dispatch<SetStateAction<NotebookItem[]>>;
    invalidateListCache: () => Promise<void>;
    syncItems: () => Promise<void>;
};

export function useNotebookItemFiles(params: UseNotebookItemFilesParams) {
    const attachFile = useCallback(async (input: {
        matrixMediaMxc: string;
        matrixMediaName?: string;
        matrixMediaMime?: string;
        matrixMediaSize?: number;
        isIndexable?: boolean;
        chunkStrategy?: string;
        chunkSize?: number;
        chunkSeparator?: string;
    }) => {
        if (!params.auth) return;
        if (params.isCreatingDraft || params.isEditing || !params.selectedItemId) {
            const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            params.setDraftFiles((prev) => ([
                ...prev,
                {
                    id: draftId,
                    matrixMediaMxc: input.matrixMediaMxc,
                    matrixMediaName: input.matrixMediaName || null,
                    matrixMediaMime: input.matrixMediaMime || null,
                    matrixMediaSize: input.matrixMediaSize ?? null,
                    createdAt: new Date().toISOString(),
                },
            ]));
            return;
        }
        params.setActionBusy(true);
        params.setActionError(null);
        try {
            const updated = await params.adapter.attachFile(params.auth, params.selectedItemId, input);
            await params.invalidateListCache();
            params.setItems((prev) => prev.map((item) => (item.id === params.selectedItemId ? updated : item)));
            void params.syncItems();
        } catch (error) {
            params.setActionError(error instanceof Error ? error.message : "Failed to attach file");
        } finally {
            params.setActionBusy(false);
        }
    }, [params]);

    const removeFile = useCallback(async (fileId: string) => {
        if (!params.auth) return;
        if (params.isCreatingDraft || params.isEditing || !params.selectedItemId) {
            params.setDraftFiles((prev) => prev.filter((file) => file.id !== fileId));
            return;
        }
        params.setActionBusy(true);
        params.setActionError(null);
        try {
            const updated = await params.adapter.removeFile(params.auth, params.selectedItemId, fileId);
            await params.invalidateListCache();
            params.setItems((prev) => prev.map((item) => (item.id === params.selectedItemId ? updated : item)));
            void params.syncItems();
        } catch (error) {
            params.setActionError(error instanceof Error ? error.message : "Failed to remove file");
        } finally {
            params.setActionBusy(false);
        }
    }, [params]);

    return { attachFile, removeFile };
}
