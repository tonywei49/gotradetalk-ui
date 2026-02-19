import type {
    NotebookAssistResponse,
    NotebookAuthContext,
    NotebookIndexStatus,
    NotebookItem,
} from "../types";

export type NotebookListQuery = {
    keyword?: string;
};

export type CreateNotebookItemInput = {
    title: string;
    contentMarkdown: string;
    itemType?: "text" | "file";
};

export type UpdateNotebookItemInput = {
    title?: string;
    contentMarkdown?: string;
};

export type AttachNotebookFileInput = {
    matrixMediaMxc: string;
    matrixMediaName?: string;
    matrixMediaMime?: string;
    matrixMediaSize?: number;
    isIndexable?: boolean;
};

export type NotebookAssistQueryInput = {
    roomId: string;
    query: string;
};

export type NotebookAssistFromContextInput = {
    roomId: string;
    anchorEventId: string;
    windowSize?: number;
};

export type NotebookSyncPushInput = {
    ops: Array<{
        clientOpId: string;
        entityType: "item" | "item_file";
        entityId: string;
        opType: "create" | "update" | "delete";
        opPayload: Record<string, unknown>;
    }>;
};

export type NotebookAdapter = {
    listItems: (auth: NotebookAuthContext, query?: NotebookListQuery) => Promise<NotebookItem[]>;
    createItem: (auth: NotebookAuthContext, input: CreateNotebookItemInput) => Promise<NotebookItem>;
    updateItem: (auth: NotebookAuthContext, itemId: string, input: UpdateNotebookItemInput) => Promise<NotebookItem>;
    deleteItem: (auth: NotebookAuthContext, itemId: string) => Promise<void>;
    attachFile: (auth: NotebookAuthContext, itemId: string, input: AttachNotebookFileInput) => Promise<NotebookItem>;
    getIndexStatus: (
        auth: NotebookAuthContext,
        itemId: string,
    ) => Promise<{ indexStatus: NotebookIndexStatus; indexError?: string | null }>;
    assistQuery: (auth: NotebookAuthContext, input: NotebookAssistQueryInput) => Promise<NotebookAssistResponse>;
    assistFromContext: (
        auth: NotebookAuthContext,
        input: NotebookAssistFromContextInput,
    ) => Promise<NotebookAssistResponse>;
    syncPush: (auth: NotebookAuthContext, input: NotebookSyncPushInput) => Promise<{ accepted: number; rejected: number }>;
};

export class NotebookApiError extends Error {
    public readonly status: number;

    public readonly code: string;

    constructor(message: string, status: number, code = "UNKNOWN") {
        super(message);
        this.name = "NotebookApiError";
        this.status = status;
        this.code = code;
    }
}
