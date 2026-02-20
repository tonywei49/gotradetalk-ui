export type NotebookItemType = "text" | "file";

export type NotebookIndexStatus = "pending" | "running" | "success" | "failed" | "skipped";

export type NotebookItem = {
    id: string;
    title: string;
    contentMarkdown: string;
    itemType: NotebookItemType;
    indexStatus: NotebookIndexStatus;
    indexError?: string | null;
    updatedAt: string;
    createdAt: string;
    matrixMediaName?: string | null;
};

export type NotebookCapability =
    | "NOTEBOOK_BASIC"
    | "NOTEBOOK_LLM_ASSIST"
    | "NOTEBOOK_RAG_ADMIN";

export type NotebookSource = {
    itemId: string;
    title: string;
    snippet: string;
    locator?: string | null;
    score?: number;
};

export type NotebookCitation = {
    sourceId: string;
    title?: string;
    locator?: string | null;
};

export type NotebookAssistResponse = {
    answer: string;
    sources: NotebookSource[];
    citations: NotebookCitation[];
    confidence: number;
    traceId: string;
};

export type NotebookListState = "loading" | "error" | "empty" | "ready";

export type NotebookAuthContext = {
    accessToken: string;
    apiBaseUrl?: string | null;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    userType?: "client" | "staff" | null;
    capabilities?: string[];
};
