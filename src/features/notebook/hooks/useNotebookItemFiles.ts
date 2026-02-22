import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { NotebookAdapter } from "../adapters/types";
import type { NotebookAuthContext, NotebookItem } from "../types";

type UseNotebookItemFilesParams = {
    adapter: NotebookAdapter;
    auth: NotebookAuthContext | null;
    selectedItemId: string | null;
    setActionBusy: (busy: boolean) => void;
    setActionError: (error: string | null) => void;
    setItems: Dispatch<SetStateAction<NotebookItem[]>>;
};

export function useNotebookItemFiles(params: UseNotebookItemFilesParams) {
    const attachFile = useCallback(async (input: {
        matrixMediaMxc: string;
        matrixMediaName?: string;
        matrixMediaMime?: string;
        matrixMediaSize?: number;
        isIndexable?: boolean;
    }) => {
        if (!params.auth || !params.selectedItemId) return;
        params.setActionBusy(true);
        params.setActionError(null);
        try {
            const updated = await params.adapter.attachFile(params.auth, params.selectedItemId, input);
            params.setItems((prev) => prev.map((item) => (item.id === params.selectedItemId ? updated : item)));
        } catch (error) {
            params.setActionError(error instanceof Error ? error.message : "Failed to attach file");
        } finally {
            params.setActionBusy(false);
        }
    }, [params]);

    const removeFile = useCallback(async (fileId: string) => {
        if (!params.auth || !params.selectedItemId) return;
        params.setActionBusy(true);
        params.setActionError(null);
        try {
            const updated = await params.adapter.removeFile(params.auth, params.selectedItemId, fileId);
            params.setItems((prev) => prev.map((item) => (item.id === params.selectedItemId ? updated : item)));
        } catch (error) {
            params.setActionError(error instanceof Error ? error.message : "Failed to remove file");
        } finally {
            params.setActionBusy(false);
        }
    }, [params]);

    return { attachFile, removeFile };
}
