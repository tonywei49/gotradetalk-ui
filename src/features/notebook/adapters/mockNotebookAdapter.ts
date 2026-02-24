import type { NotebookAssistResponse, NotebookIndexStatus, NotebookItem } from "../types";
import type {
    NotebookAdapter,
} from "./types";
import { NotebookApiError } from "./types";

const MOCK_INDEX_TRANSITION_MS = 7000;

const initialItems: NotebookItem[] = [
    {
        id: "nb-1",
        title: "產品 FAQ",
        contentMarkdown: "客戶常見問題與回覆模板。",
        isIndexable: true,
        itemType: "text",
        indexStatus: "success",
        indexError: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
        files: [],
    },
    {
        id: "nb-2",
        title: "Q4 產品目錄.pdf",
        contentMarkdown: "已上傳檔案，等待索引。",
        isIndexable: true,
        itemType: "file",
        matrixMediaName: "Q4-catalog.pdf",
        indexStatus: "running",
        indexError: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
        files: [
            {
                id: "nb-2-file-1",
                matrixMediaMxc: "mxc://mock.server/q4-catalog",
                matrixMediaName: "Q4-catalog.pdf",
                matrixMediaMime: "application/pdf",
                matrixMediaSize: 123456,
                createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
            },
        ],
    },
];

let db: NotebookItem[] = [...initialItems];

function wait(ms = 250): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function nextId(): string {
    return `nb-${Math.random().toString(16).slice(2, 10)}`;
}

function cloneItem(item: NotebookItem): NotebookItem {
    return {
        ...item,
        files: item.files.map((file) => ({ ...file })),
    };
}

function cloneList(items: NotebookItem[]): NotebookItem[] {
    return items.map(cloneItem);
}

function ensureAssistAllowed(params: { userType?: string | null; capabilities?: string[] }): void {
    if (params.userType === "client") {
        throw new NotebookApiError("Client role cannot use notebook assist", 403, "FORBIDDEN_ROLE");
    }
    const caps = params.capabilities ?? [];
    if (!caps.includes("NOTEBOOK_LLM_ASSIST")) {
        throw new NotebookApiError("Notebook assist capability disabled", 403, "CAPABILITY_DISABLED");
    }
}

function refreshIndexStatuses(): void {
    const now = Date.now();
    db = db.map((item) => {
        if ((item.indexStatus === "pending" || item.indexStatus === "running") && now - Date.parse(item.updatedAt) > MOCK_INDEX_TRANSITION_MS) {
            return {
                ...item,
                indexStatus: "success",
                updatedAt: new Date().toISOString(),
            };
        }
        return item;
    });
}

function buildAssistResponse(query: string): NotebookAssistResponse {
    const normalized = query.toLowerCase();
    if (normalized.includes("不存在") || normalized.includes("unknown") || normalized.includes("hallucination")) {
        return {
            answer: "知識庫未找到明確依據，建議先向產品團隊確認後再回覆客戶。",
            confidence: 0.38,
            traceId: `mock-trace-${Date.now()}`,
            sources: [],
            citations: [],
        };
    }
    return {
        answer: "根據現有知識庫，該功能支援標準版本。若需企業版差異，請附上客戶方案等級再確認。",
        confidence: 0.78,
        traceId: `mock-trace-${Date.now()}`,
        sources: [
            {
                itemId: "nb-1",
                title: "產品 FAQ",
                snippet: "標準版本支援核心功能，企業版有額外權限與稽核。",
                locator: "section:2",
            },
        ],
        citations: [
            {
                sourceId: "nb-1:1",
                title: "產品 FAQ",
                locator: "section:2",
            },
        ],
    };
}

export const mockNotebookAdapter: NotebookAdapter = {
    async listItems(_auth, query) {
        await wait();
        refreshIndexStatuses();
        const keyword = (query?.keyword || "").trim().toLowerCase();
        const rows = db.filter((item) => {
            if (typeof query?.isIndexable === "boolean" && item.isIndexable !== query.isIndexable) {
                return false;
            }
            if (!keyword) return true;
            return item.title.toLowerCase().includes(keyword) || item.contentMarkdown.toLowerCase().includes(keyword);
        });
        return cloneList(rows).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },
    async createItem(_auth, input) {
        await wait();
        const now = new Date().toISOString();
        const created: NotebookItem = {
            id: nextId(),
            title: input.title,
            contentMarkdown: input.contentMarkdown,
            isIndexable: input.isIndexable ?? true,
            itemType: input.itemType ?? "text",
            indexStatus: (input.isIndexable ?? true)
                ? (input.itemType === "file" ? "pending" : "success")
                : "skipped",
            indexError: null,
            createdAt: now,
            updatedAt: now,
            matrixMediaName: null,
            files: [],
        };
        db = [created, ...db];
        return cloneItem(created);
    },
    async updateItem(_auth, itemId, input) {
        await wait();
        const target = db.find((item) => item.id === itemId);
        if (!target) {
            throw new NotebookApiError("Notebook item not found", 404, "ITEM_NOT_FOUND");
        }
        const next: NotebookItem = {
            ...target,
            title: input.title ?? target.title,
            contentMarkdown: input.contentMarkdown ?? target.contentMarkdown,
            isIndexable: input.isIndexable ?? target.isIndexable,
            indexStatus: typeof input.isIndexable === "boolean"
                ? (input.isIndexable ? "pending" : "skipped")
                : target.indexStatus,
            indexError: typeof input.isIndexable === "boolean" && !input.isIndexable
                ? null
                : target.indexError,
            updatedAt: new Date().toISOString(),
        };
        db = db.map((item) => (item.id === itemId ? next : item));
        return cloneItem(next);
    },
    async deleteItem(_auth, itemId) {
        await wait();
        db = db.filter((item) => item.id !== itemId);
    },
    async attachFile(_auth, itemId, input) {
        await wait();
        const target = db.find((item) => item.id === itemId);
        if (!target) {
            throw new NotebookApiError("Notebook item not found", 404, "ITEM_NOT_FOUND");
        }
        const next: NotebookItem = {
            ...target,
            itemType: "file",
            matrixMediaName: input.matrixMediaName || "file",
            isIndexable: input.isIndexable ?? target.isIndexable,
            indexStatus: (input.isIndexable ?? target.isIndexable) ? "pending" : "skipped",
            updatedAt: new Date().toISOString(),
            files: [
                {
                    id: nextId(),
                    matrixMediaMxc: input.matrixMediaMxc,
                    matrixMediaName: input.matrixMediaName || "file",
                    matrixMediaMime: input.matrixMediaMime || null,
                    matrixMediaSize: input.matrixMediaSize || null,
                    createdAt: new Date().toISOString(),
                },
                ...target.files,
            ],
        };
        db = db.map((item) => (item.id === itemId ? next : item));
        return cloneItem(next);
    },
    async removeFile(_auth, itemId, fileId) {
        await wait();
        const target = db.find((item) => item.id === itemId);
        if (!target) {
            throw new NotebookApiError("Notebook item not found", 404, "ITEM_NOT_FOUND");
        }
        const files = target.files.filter((file) => file.id !== fileId);
        const next: NotebookItem = {
            ...target,
            itemType: files.length > 0 ? "file" : "text",
            matrixMediaName: files[0]?.matrixMediaName || null,
            files,
            indexStatus: target.isIndexable && files.length > 0 ? "pending" : "skipped",
            updatedAt: new Date().toISOString(),
        };
        db = db.map((item) => (item.id === itemId ? next : item));
        return cloneItem(next);
    },
    async retryIndex(_auth, itemId) {
        await wait(120);
        const target = db.find((item) => item.id === itemId);
        if (!target) {
            throw new NotebookApiError("Notebook item not found", 404, "ITEM_NOT_FOUND");
        }
        const next: NotebookItem = {
            ...target,
            indexStatus: target.isIndexable ? "pending" : "skipped",
            indexError: null,
            updatedAt: new Date().toISOString(),
        };
        db = db.map((item) => (item.id === itemId ? next : item));
        return cloneItem(next);
    },
    async getIndexStatus(_auth, itemId) {
        await wait(100);
        refreshIndexStatuses();
        const target = db.find((item) => item.id === itemId);
        if (!target) {
            throw new NotebookApiError("Notebook item not found", 404, "ITEM_NOT_FOUND");
        }
        return {
            indexStatus: target.indexStatus,
            indexError: target.indexError,
        };
    },
    async getParsedPreview(_auth, itemId) {
        await wait(120);
        const target = db.find((item) => item.id === itemId);
        if (!target) {
            throw new NotebookApiError("Notebook item not found", 404, "ITEM_NOT_FOUND");
        }
        const text = `${target.title}\n\n${target.contentMarkdown}`.trim();
        return {
            text,
            truncated: false,
            chunkCountSampled: text ? 1 : 0,
            chunkCountTotal: text ? 1 : 0,
            totalChars: text.length,
            totalTokens: Math.ceil(text.length / 3),
        };
    },
    async getChunks(_auth, itemId) {
        await wait(120);
        const target = db.find((item) => item.id === itemId);
        if (!target) {
            throw new NotebookApiError("Notebook item not found", 404, "ITEM_NOT_FOUND");
        }
        const text = `${target.title}\n\n${target.contentMarkdown}`.trim();
        return {
            chunks: text
                ? [{
                    id: `${itemId}-chunk-1`,
                    chunkIndex: 0,
                    chunkText: text,
                    tokenCount: Math.ceil(text.length / 3),
                    sourceType: target.itemType === "file" ? "docx" : "text",
                    sourceLocator: target.itemType === "file" ? "page:1" : null,
                }]
                : [],
            total: text ? 1 : 0,
        };
    },
    async assistQuery(auth, input) {
        await wait(450);
        ensureAssistAllowed({ userType: auth.userType, capabilities: auth.capabilities });
        if (!db.some((item) => item.isIndexable)) {
            throw new NotebookApiError("No knowledge base items available", 422, "INVALID_CONTEXT");
        }
        return buildAssistResponse(input.query);
    },
    async assistFromContext(auth, input) {
        await wait(500);
        ensureAssistAllowed({ userType: auth.userType, capabilities: auth.capabilities });
        if (!input.anchorEventId || input.anchorEventId.startsWith("invalid")) {
            throw new NotebookApiError("Invalid context anchor", 422, "INVALID_CONTEXT");
        }
        const contextualQuery = `context:${input.anchorEventId}:${input.windowSize ?? 5}`;
        return buildAssistResponse(contextualQuery);
    },
    async syncPush(_auth, input) {
        await wait(180);
        return {
            accepted: input.ops.length,
            rejected: 0,
        };
    },
};

export function resetMockNotebookData(): void {
    db = [...initialItems];
}

export function getMockIndexState(itemId: string): NotebookIndexStatus | null {
    return db.find((item) => item.id === itemId)?.indexStatus ?? null;
}
