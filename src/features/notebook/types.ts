export type NotebookItemType = "text" | "file";

export type NotebookIndexStatus = "pending" | "running" | "success" | "failed" | "skipped";

export type NotebookItemFile = {
    id: string;
    matrixMediaMxc: string;
    matrixMediaName?: string | null;
    matrixMediaMime?: string | null;
    matrixMediaSize?: number | null;
    createdAt: string;
};

export type NotebookItem = {
    id: string;
    title: string;
    contentMarkdown: string;
    isIndexable: boolean;
    itemType: NotebookItemType;
    indexStatus: NotebookIndexStatus;
    indexError?: string | null;
    latestIndexJobId?: string | null;
    updatedAt: string;
    createdAt: string;
    matrixMediaName?: string | null;
    files: NotebookItemFile[];
    sourceScope?: "personal" | "company";
    sourceFileName?: string | null;
    readOnly?: boolean;
};

export type NotebookChunk = {
    id: string;
    chunkIndex: number;
    chunkText: string;
    tokenCount?: number | null;
    sourceType?: string | null;
    sourceLocator?: string | null;
};

export type NotebookParsedPreview = {
    text: string;
    truncated: boolean;
    chunkCountSampled: number;
    chunkCountTotal: number;
    totalChars: number;
    totalTokens: number;
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
    sourceScope?: "personal" | "company";
    sourceFileName?: string | null;
    updatedAt?: string | null;
};

export type NotebookCitation = {
    sourceId: string;
    title?: string;
    locator?: string | null;
    sourceScope?: "personal" | "company";
    sourceFileName?: string | null;
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
    matrixAccessToken?: string | null;
    apiBaseUrl?: string | null;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    userType?: "client" | "staff" | null;
    capabilities?: string[];
};
