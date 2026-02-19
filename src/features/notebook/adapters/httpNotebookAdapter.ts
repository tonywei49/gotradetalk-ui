import {
    assistFromContext,
    assistQuery,
    attachNotebookFile,
    createNotebookItem,
    deleteNotebookItem,
    getNotebookItemIndexStatus,
    getNotebookItems,
    type NotebookAssistSourceDto,
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
        title: dto.title || "",
        contentMarkdown: dto.content_markdown || "",
        itemType: dto.item_type,
        indexStatus: dto.index_status,
        indexError: dto.index_error,
        updatedAt: dto.updated_at,
        createdAt: dto.created_at,
        matrixMediaName: dto.matrix_media_name,
    };
}

function mapSource(source: NotebookAssistSourceDto) {
    return {
        itemId: source.item_id,
        title: source.title || source.item_id,
        snippet: source.snippet,
        locator: source.source_locator,
        score: source.score,
    };
}

function mapAssist(dto: Awaited<ReturnType<typeof assistQuery>>): NotebookAssistResponse {
    const sourceMap = new Map(dto.sources.map((source, idx) => [`${source.item_id}:${idx + 1}`, source]));
    return {
        answer: dto.answer,
        sources: dto.sources.map(mapSource),
        citations: dto.citations.map((citation) => {
            const linkedSource = sourceMap.get(citation.source_id);
            return {
                sourceId: citation.source_id,
                title: linkedSource?.title || linkedSource?.item_id,
                locator: citation.locator,
            };
        }),
        confidence: dto.confidence,
        traceId: dto.trace_id || "",
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
            const data = await getNotebookItems(auth, { q: query?.keyword || "" });
            return (data.items ?? []).map(mapItem);
        } catch (error) {
            throw mapError(error);
        }
    },
    async createItem(auth, input) {
        try {
            const response = await createNotebookItem(auth, {
                title: input.title,
                content_markdown: input.contentMarkdown,
                item_type: input.itemType ?? "text",
            });
            return mapItem(response.item);
        } catch (error) {
            throw mapError(error);
        }
    },
    async updateItem(auth, itemId, input) {
        try {
            const response = await updateNotebookItem(auth, itemId, {
                title: input.title,
                content_markdown: input.contentMarkdown,
            });
            return mapItem(response.item);
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
            const response = await attachNotebookFile(auth, itemId, {
                matrix_media_mxc: input.matrixMediaMxc,
                matrix_media_name: input.matrixMediaName,
                matrix_media_mime: input.matrixMediaMime,
                matrix_media_size: input.matrixMediaSize,
                is_indexable: input.isIndexable ?? true,
            });
            return mapItem(response.item);
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
            const response = await pushNotebookSync(auth, {
                device_id: auth.matrixUserId || "ui-web",
                ops: input.ops.map((op) => ({
                    client_op_id: op.clientOpId,
                    entity_type: op.entityType,
                    entity_id: op.entityId,
                    op_type: op.opType,
                    op_payload: op.opPayload,
                })),
            });
            const accepted = response.results.filter((item) => item.status === "applied" || item.status === "duplicate").length;
            return {
                accepted,
                rejected: Math.max(0, response.results.length - accepted),
            };
        } catch (error) {
            throw mapError(error);
        }
    },
};
