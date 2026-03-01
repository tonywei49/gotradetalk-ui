import {
    assistFromContext,
    assistQuery,
    attachNotebookFile,
    createNotebookItem,
    deleteNotebookItemFile,
    deleteNotebookItem,
    getNotebookItemIndexStatus,
    getNotebookItemParsedPreview,
    getNotebookItemChunks,
    getNotebookItems,
    reindexNotebookItem,
    retryNotebookIndexJob,
    type NotebookAssistSourceDto,
    type NotebookItemFileDto,
    type NotebookItemDto,
    type NotebookServiceError,
    pushNotebookSync,
    updateNotebookItem,
} from "../../../services/notebookApi";
import type { NotebookAssistResponse, NotebookIndexStatus, NotebookItem, NotebookSource } from "../types";
import type { NotebookAdapter, NotebookListQuery } from "./types";
import { NotebookApiError } from "./types";
import { NOTEBOOK_CHUNKS_FETCH_LIMIT, NOTEBOOK_PARSED_PREVIEW_CHARS, NOTEBOOK_PARSED_PREVIEW_LIMIT } from "../constants";

function mapItem(dto: NotebookItemDto): NotebookItem {
    const files = (dto.files ?? []).map((file: NotebookItemFileDto) => ({
        id: file.id,
        matrixMediaMxc: file.matrix_media_mxc,
        matrixMediaName: file.matrix_media_name,
        matrixMediaMime: file.matrix_media_mime,
        matrixMediaSize: file.matrix_media_size,
        createdAt: file.created_at,
    }));
    return {
        id: dto.id,
        title: dto.title || "",
        contentMarkdown: dto.content_markdown || "",
        isIndexable: dto.is_indexable !== false,
        itemType: dto.item_type,
        indexStatus: dto.index_status,
        indexError: dto.index_error,
        latestIndexJobId: dto.latest_index_job_id || dto.last_index_job_id || dto.index_job_id || null,
        updatedAt: dto.updated_at,
        createdAt: dto.created_at,
        matrixMediaName: dto.matrix_media_name,
        files,
        sourceScope: dto.source_scope === "company" ? "company" : "personal",
        sourceFileName: dto.source_file_name || null,
        readOnly: Boolean(dto.read_only) || dto.source_scope === "company",
    };
}

function mapSource(source: NotebookAssistSourceDto): NotebookSource {
    return {
        itemId: source.item_id,
        title: source.title || source.item_id,
        snippet: source.snippet,
        locator: source.source_locator,
        score: source.score,
        sourceScope: source.source_scope === "company" ? "company" : "personal",
        sourceFileName: source.source_file_name || null,
        updatedAt: source.updated_at || null,
    };
}

function mapAssist(dto: Awaited<ReturnType<typeof assistQuery>>): NotebookAssistResponse {
    const sourceMap = new Map(dto.sources.map((source, idx) => [`${source.item_id}:${idx + 1}`, source]));
    return {
        answer: dto.answer,
        summaryText: dto.summary_text || null,
        referenceAnswer: dto.reference_answer || null,
        sources: dto.sources.map(mapSource),
        citations: dto.citations.map((citation) => {
            const linkedSource = sourceMap.get(citation.source_id);
            return {
                sourceId: citation.source_id,
                title: linkedSource?.title || linkedSource?.item_id,
                locator: citation.locator,
                sourceScope: citation.source_scope === "company" ? "company" : "personal",
                sourceFileName: citation.source_file_name || null,
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

async function fetchListPage(auth: Parameters<NotebookAdapter["listItemsPage"]>[0], query?: NotebookListQuery) {
    const data = await getNotebookItems(auth, {
        q: query?.keyword || "",
        filter: query?.filter,
        scope: query?.scope,
        is_indexable: query?.isIndexable,
        cursor: query?.cursor,
        limit: query?.limit,
    });
    return {
        items: (data.items ?? []).map(mapItem),
        nextCursor: data.next_cursor ?? null,
    };
}

export const httpNotebookAdapter: NotebookAdapter = {
    async listItemsPage(auth, query) {
        try {
            return await fetchListPage(auth, query);
        } catch (error) {
            throw mapError(error);
        }
    },
    async listItems(auth, query) {
        try {
            const page = await fetchListPage(auth, query);
            return page.items;
        } catch (error) {
            throw mapError(error);
        }
    },
    async createItem(auth, input) {
        try {
            const response = await createNotebookItem(auth, {
                title: input.title,
                content_markdown: input.contentMarkdown,
                is_indexable: input.isIndexable ?? true,
                item_type: input.itemType ?? "text",
                chunk_strategy: input.chunkStrategy,
                chunk_size: input.chunkSize,
                chunk_separator: input.chunkSeparator,
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
                is_indexable: input.isIndexable,
                chunk_strategy: input.chunkStrategy,
                chunk_size: input.chunkSize,
                chunk_separator: input.chunkSeparator,
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
                chunk_strategy: input.chunkStrategy,
                chunk_size: input.chunkSize,
                chunk_separator: input.chunkSeparator,
            });
            return mapItem(response.item);
        } catch (error) {
            throw mapError(error);
        }
    },
    async removeFile(auth, itemId, fileId) {
        try {
            const response = await deleteNotebookItemFile(auth, itemId, fileId);
            return mapItem(response.item);
        } catch (error) {
            throw mapError(error);
        }
    },
    async retryIndex(auth, itemId) {
        try {
            const list = await getNotebookItems(auth, { filter: "all", limit: 200 });
            const current = (list.items ?? []).find((item) => item.id === itemId);
            const latestJobId = current?.latest_index_job_id || current?.last_index_job_id || current?.index_job_id || null;

            if (latestJobId) {
                const retried = await retryNotebookIndexJob(auth, latestJobId);
                if (retried.item) return mapItem(retried.item);
            }

            const reindexed = await reindexNotebookItem(auth, itemId);
            return mapItem(reindexed.item);
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
    async getParsedPreview(auth, itemId) {
        try {
            const data = await getNotebookItemParsedPreview(auth, itemId, {
                limit: NOTEBOOK_PARSED_PREVIEW_LIMIT,
                chars: NOTEBOOK_PARSED_PREVIEW_CHARS,
            });
            return {
                text: data.preview.text || "",
                truncated: Boolean(data.preview.truncated),
                chunkCountSampled: Number(data.preview.chunk_count_sampled || 0),
                chunkCountTotal: Number(data.preview.chunk_count_total || 0),
                totalChars: Number(data.preview.total_chars || 0),
                totalTokens: Number(data.preview.total_tokens || 0),
            };
        } catch (error) {
            throw mapError(error);
        }
    },
    async getChunks(auth, itemId) {
        try {
            const data = await getNotebookItemChunks(auth, itemId, { limit: NOTEBOOK_CHUNKS_FETCH_LIMIT });
            return {
                chunks: (data.chunks || []).map((chunk) => ({
                    id: chunk.id,
                    chunkIndex: Number(chunk.chunk_index || 0),
                    chunkText: chunk.chunk_text || "",
                    tokenCount: chunk.token_count ?? null,
                    sourceType: chunk.source_type || null,
                    sourceLocator: chunk.source_locator || null,
                })),
                total: Number(data.total || 0),
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
                knowledge_scope: input.knowledgeScope,
                response_lang: input.responseLang,
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
                knowledge_scope: input.knowledgeScope,
                response_lang: input.responseLang,
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
