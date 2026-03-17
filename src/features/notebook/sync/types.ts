export type NotebookSyncStatus =
    | "synced"
    | "pending_create"
    | "pending_update"
    | "pending_delete"
    | "sync_failed";

export type NotebookSyncQueueStatus = "pending" | "processing" | "failed";

export type NotebookSyncEntityType = "item" | "item_file";

export type NotebookSyncOperationType = "create" | "update" | "delete";

export type NotebookLocalId = string;

export type NotebookServerId = string;

export type NotebookSyncNamespace = {
    userId: string;
    apiBaseUrl: string;
};

export type NotebookSyncQueueEntry = {
    id: string;
    userId: string;
    apiBaseUrl: string;
    entityType: NotebookSyncEntityType;
    entityLocalId: NotebookLocalId;
    entityServerId?: NotebookServerId | null;
    operationType: NotebookSyncOperationType;
    payload: Record<string, unknown>;
    status: NotebookSyncQueueStatus;
    retryCount: number;
    lastError?: string | null;
    createdAt: string;
    updatedAt: string;
};

export type NotebookLocalSyncRecord = {
    localId: NotebookLocalId;
    serverId?: NotebookServerId | null;
    userId: string;
    apiBaseUrl: string;
    syncStatus: NotebookSyncStatus;
    deletedAt?: string | null;
    createdAt: string;
    localUpdatedAt: string;
    serverUpdatedAt?: string | null;
};

export type NotebookPendingMutation = {
    entityType: NotebookSyncEntityType;
    entityLocalId: NotebookLocalId;
    entityServerId?: NotebookServerId | null;
    operationType: NotebookSyncOperationType;
    payload: Record<string, unknown>;
};

export function createNotebookLocalId(entityType: NotebookSyncEntityType): NotebookLocalId {
    return `local:${entityType}:${safeRandomId()}`;
}

export function isNotebookLocalOnlyId(id: string | null | undefined): boolean {
    return typeof id === "string" && id.startsWith("local:");
}

export function nextNotebookSyncStatus(
    currentStatus: NotebookSyncStatus | null | undefined,
    operationType: NotebookSyncOperationType,
): NotebookSyncStatus {
    if (operationType === "create") return "pending_create";
    if (operationType === "delete") {
        return currentStatus === "pending_create" ? "pending_delete" : "pending_delete";
    }
    if (currentStatus === "pending_create") return "pending_create";
    return "pending_update";
}

export function shouldKeepLocalRowAfterDelete(
    currentStatus: NotebookSyncStatus | null | undefined,
): boolean {
    return currentStatus !== "pending_create";
}
import { safeRandomId } from "../../../utils/randomId";
