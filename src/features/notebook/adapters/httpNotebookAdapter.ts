import {
    assistFromContext,
    assistQuery,
    attachNotebookFile,
    createNotebookItem,
    deleteNotebookItem,
    getNotebookItemIndexStatus,
    getNotebookItems,
    type NotebookItemDto,
    type NotebookServiceError,
    pushNotebookSync,
    updateNotebookItem,
} from "../../../services/notebookApi";
import type { NotebookAssistResponse, NotebookIndexStatus, NotebookItem } from "../types";
import type { NotebookAdapter } from "./types";
import { NotebookApiError } from "./types";

function mapItem(dto: NotebookItemDto): NotebookItem {
    return {
        id: dto.id,
        title: dto.title,
        contentMarkdown: dto.content_markdown,
        itemType: dto.item_type,
        indexStatus: dto.index_status,
        indexError: dto.index_error,
        updatedAt: dto.updated_at,
        createdAt: dto.created_at,
        matrixMediaName: dto.matrix_media_name,
    };
}

function mapAssist(dto: Awaited<ReturnType<typeof assistQuery>>): NotebookAssistResponse {
    return {
        answer: dto.answer,
        sources: dto.sources,
        citations: dto.citations,
        confidence: dto.confidence,
        traceId: dto.traceId || dto.trace_id || "",
    };
}

function mapError(error: unknown): NotebookApiError {
    if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        typeof (error as NotebookServiceError).status === "number" &&
        "code" in error &&
        typeof (error as NotebookServiceError).code === "string"
    ) {
        const typed = error as NotebookServiceError;
        return new NotebookApiError(typed.message, typed.status, typed.code);
    }
    if (error instanceof Error) {
        return new NotebookApiError(error.message, 500, "UNKNOWN");
    }
    return new NotebookApiError("Unknown notebook API error", 500, "UNKNOWN");
}

export const httpNotebookAdapter: NotebookAdapter = {
    async listItems(auth, query) {
        try {
            const data = await getNotebookItems(auth, query?.keyword);
            return (data.items ?? []).map(mapItem);
        } catch (error) {
            throw mapError(error);
        }
    },
    async createItem(auth, input) {
        try {
            return mapItem(await createNotebookItem(auth, {
                title: input.title,
                content_markdown: input.contentMarkdown,
                item_type: input.itemType ?? "text",
            }));
        } catch (error) {
            throw mapError(error);
        }
    },
    async updateItem(auth, itemId, input) {
        try {
            return mapItem(await updateNotebookItem(auth, itemId, {
                title: input.title,
                content_markdown: input.contentMarkdown,
            }));
        } catch (error) {
            throw mapError(error);
        }
    },
    async deleteItem(auth, itemId) {
        try {
            await deleteNotebookItem(auth, itemId);
        } catch (error) {
            throw mapError(error);
        }
    },
    async attachFile(auth, itemId, input) {
        try {
            return mapItem(await attachNotebookFile(auth, itemId, {
                file_name: input.fileName,
            }));
        } catch (error) {
            throw mapError(error);
        }
    },
    async getIndexStatus(auth, itemId) {
        try {
            const data = await getNotebookItemIndexStatus(auth, itemId);
            return {
                indexStatus: data.index_status as NotebookIndexStatus,
                indexError: data.index_error,
            };
        } catch (error) {
            throw mapError(error);
        }
    },
    async assistQuery(auth, input) {
        try {
            return mapAssist(await assistQuery(auth, {
                room_id: input.roomId,
                query: input.query,
            }));
        } catch (error) {
            throw mapError(error);
        }
    },
    async assistFromContext(auth, input) {
        try {
            return mapAssist(await assistFromContext(auth, {
                room_id: input.roomId,
                anchor_event_id: input.anchorEventId,
                window_size: input.windowSize ?? 5,
            }));
        } catch (error) {
            throw mapError(error);
        }
    },
    async syncPush(auth, input) {
        try {
            return await pushNotebookSync(auth, {
                ops: input.ops.map((op) => ({
                    client_op_id: op.clientOpId,
                    entity_type: op.entityType,
                    entity_id: op.entityId,
                    op_type: op.opType,
                    op_payload: op.opPayload,
                })),
            });
        } catch (error) {
            throw mapError(error);
        }
    },
};
