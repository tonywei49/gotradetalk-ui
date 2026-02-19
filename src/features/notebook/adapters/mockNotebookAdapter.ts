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
        itemType: "text",
        indexStatus: "success",
        indexError: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
    },
    {
        id: "nb-2",
        title: "Q4 產品目錄.pdf",
        contentMarkdown: "已上傳檔案，等待索引。",
        itemType: "file",
        matrixMediaName: "Q4-catalog.pdf",
        indexStatus: "running",
        indexError: null,
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
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
        const rows = keyword
            ? db.filter((item) => item.title.toLowerCase().includes(keyword) || item.contentMarkdown.toLowerCase().includes(keyword))
            : db;
        return cloneList(rows).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },
    async createItem(_auth, input) {
        await wait();
        const now = new Date().toISOString();
        const created: NotebookItem = {
            id: nextId(),
            title: input.title,
            contentMarkdown: input.contentMarkdown,
            itemType: input.itemType ?? "text",
            indexStatus: input.itemType === "file" ? "pending" : "success",
            indexError: null,
            createdAt: now,
            updatedAt: now,
            matrixMediaName: null,
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
            indexStatus: "pending",
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
    async assistQuery(auth, input) {
        await wait(450);
        ensureAssistAllowed({ userType: auth.userType, capabilities: auth.capabilities });
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
