import { notebookApiBaseUrl } from "../config";
import { fetchWithDesktopSupport } from "../desktop/fetchWithDesktopSupport";

export type NotebookApiErrorCode =
    | "MANAGED_BY_PLATFORM"
    | "CAPABILITY_DISABLED"
    | "CAPABILITY_EXPIRED"
    | "QUOTA_EXCEEDED"
    | "INVALID_CONTEXT"
    | "FORBIDDEN_ROLE"
    | "VALIDATION_ERROR"
    | "UNAUTHORIZED"
    | "INVALID_AUTH_TOKEN"
    | "INVALID_TOKEN_TYPE"
    | "TIMEOUT"
    | "NOT_FOUND"
    | "NO_VALID_HUB_TOKEN"
    | "UNKNOWN";

export class NotebookServiceError extends Error {
    public readonly status: number;

    public readonly code: NotebookApiErrorCode;

    public readonly details: unknown;

    constructor(message: string, status: number, code: NotebookApiErrorCode, details: unknown = null) {
        super(message);
        this.name = "NotebookServiceError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export type NotebookRequestDebugSnapshot = {
    timestamp: string;
    method: string;
    path: string;
    url: string;
    query: Record<string, string>;
    requestBody: unknown;
    auth: {
        apiBaseUrl: string | null;
        hsUrl: string | null;
        matrixUserId: string | null;
        accessTokenPresent: boolean;
        accessTokenKind: "hub-jwt" | "non-jwt" | "missing";
        matrixAccessTokenPresent: boolean;
    };
    response: {
        ok: boolean;
        status: number | null;
        statusText: string | null;
        body: unknown;
    } | null;
    error: {
        message: string;
        code: string | null;
        status: number | null;
    } | null;
};

let lastNotebookRequestDebugSnapshot: NotebookRequestDebugSnapshot | null = null;

export function getLastNotebookRequestDebugSnapshot(): NotebookRequestDebugSnapshot | null {
    return lastNotebookRequestDebugSnapshot;
}

export type NotebookApiAuth = {
    accessToken: string;
    matrixAccessToken?: string | null;
    apiBaseUrl?: string | null;
    hsUrl?: string | null;
    matrixUserId?: string | null;
};

export type NotebookItemDto = {
    id: string;
    title: string | null;
    content_markdown: string | null;
    is_indexable?: boolean | null;
    item_type: "text" | "file";
    index_status: "pending" | "running" | "success" | "failed" | "skipped";
    index_error?: string | null;
    latest_index_job_id?: string | null;
    last_index_job_id?: string | null;
    index_job_id?: string | null;
    updated_at: string;
    created_at: string;
    matrix_media_name?: string | null;
    files?: NotebookItemFileDto[];
    source_scope?: "personal" | "company" | null;
    source_file_name?: string | null;
    read_only?: boolean | null;
};

export type NotebookItemFileDto = {
    id: string;
    item_id: string;
    matrix_media_mxc: string;
    matrix_media_name?: string | null;
    matrix_media_mime?: string | null;
    matrix_media_size?: number | null;
    created_at: string;
};

export type NotebookChunkDto = {
    id: string;
    item_id: string;
    chunk_index: number;
    chunk_text: string;
    token_count?: number | null;
    source_type?: string | null;
    source_locator?: string | null;
    created_at: string;
    updated_at: string;
};

export type GetNotebookItemsResponse = {
    items: NotebookItemDto[];
    next_cursor: string | null;
};

export type NotebookCapabilitiesResponse = {
    user_id: string;
    company_id: string;
    role: "staff" | "client" | "admin";
    capabilities: string[];
};

export type CompanyNotebookAiSettingsResponse = {
    managed_by_platform: boolean;
    notebook_ai_enabled: boolean;
    notebook_ai_expire_at: string | null;
    notebook_ai_quota_monthly_requests: number | null;
    notebook_ai_quota_used_monthly_requests: number | null;
    notebook_upload_max_mb?: number | null;
};

export type CompanyTranslationSettingsResponse = {
    managed_by_platform: boolean;
    translation_enabled: boolean;
    translation_expire_at: string | null;
    translation_quota_monthly_requests: number | null;
    translation_quota_used_monthly_requests: number | null;
};

export type AssistFromContextRequest = {
    room_id: string;
    anchor_event_id: string;
    window_size?: number;
    response_lang?: string;
    knowledge_scope?: "personal" | "company" | "both";
};

export type NotebookAssistSourceDto = {
    item_id: string;
    title: string | null;
    snippet: string;
    source_locator?: string | null;
    score?: number;
    source_scope?: "personal" | "company" | null;
    source_file_name?: string | null;
    updated_at?: string | null;
};

export type NotebookAssistCitationDto = {
    source_id: string;
    locator?: string | null;
    source_scope?: "personal" | "company" | null;
    source_file_name?: string | null;
};

export type NotebookAssistResponseDto = {
    answer: string;
    summary_text?: string | null;
    reference_answer?: string | null;
    sources: NotebookAssistSourceDto[];
    citations: NotebookAssistCitationDto[];
    confidence: number;
    trace_id?: string;
    context_message_ids?: string[];
    guardrail?: {
        insufficient_evidence?: boolean;
    };
};

export type NotebookSyncPushRequest = {
    device_id: string;
    ops: Array<{
        client_op_id: string;
        entity_type: "item" | "item_file";
        entity_id: string;
        op_type: "create" | "update" | "delete";
        op_payload: Record<string, unknown>;
        base_revision?: number;
    }>;
};

export type NotebookSyncPushResponse = {
    results: Array<{
        client_op_id: string;
        status: string;
        server_revision: number | null;
        conflict_copy_id: string | null;
    }>;
    server_cursor: string;
};

type ErrorPayload = {
    message?: string;
    error?: string;
    code?: string;
};

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

function truncateString(value: string, maxLength = 600): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}…(${value.length - maxLength} more chars)`;
}

function sanitizeDebugValue(value: unknown): unknown {
    if (value == null) return value;
    if (typeof value === "string") return truncateString(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
        return value.slice(0, 20).map((entry) => sanitizeDebugValue(entry));
    }
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).slice(0, 30);
        return Object.fromEntries(entries.map(([key, entry]) => [key, sanitizeDebugValue(entry)]));
    }
    return String(value);
}

function parseQuery(url: string): Record<string, string> {
    const result: Record<string, string> = {};
    const parsed = new URL(url);
    parsed.searchParams.forEach((value, key) => {
        result[key] = value;
    });
    return result;
}

function tokenKind(token: string | null | undefined): "hub-jwt" | "non-jwt" | "missing" {
    if (!token?.trim()) return "missing";
    return isLikelyHubJwtToken(token) ? "hub-jwt" : "non-jwt";
}

function setNotebookRequestDebugSnapshot(snapshot: NotebookRequestDebugSnapshot): void {
    lastNotebookRequestDebugSnapshot = snapshot;
}

function createNotebookRequestDebugSnapshot(params: {
    auth: NotebookApiAuth;
    method: string;
    path: string;
    url: string;
    requestBody?: unknown;
    response?: NotebookRequestDebugSnapshot["response"];
    error?: NotebookRequestDebugSnapshot["error"];
}): NotebookRequestDebugSnapshot {
    return {
        timestamp: new Date().toISOString(),
        method: params.method,
        path: params.path,
        url: params.url,
        query: parseQuery(params.url),
        requestBody: sanitizeDebugValue(params.requestBody ?? null),
        auth: {
            apiBaseUrl: params.auth.apiBaseUrl ?? null,
            hsUrl: params.auth.hsUrl ?? null,
            matrixUserId: params.auth.matrixUserId ?? null,
            accessTokenPresent: Boolean(params.auth.accessToken?.trim()),
            accessTokenKind: tokenKind(params.auth.accessToken),
            matrixAccessTokenPresent: Boolean(params.auth.matrixAccessToken?.trim()),
        },
        response: params.response ?? null,
        error: params.error ?? null,
    };
}

function buildUrl(path: string, auth: NotebookApiAuth, query?: Record<string, string>): string {
    const base = normalizeBaseUrl(auth.apiBaseUrl || notebookApiBaseUrl);
    const url = new URL(`${base}${path}`);
    if (auth.hsUrl) {
        url.searchParams.set("hs_url", auth.hsUrl);
    }
    if (auth.matrixUserId) {
        url.searchParams.set("matrix_user_id", auth.matrixUserId);
    }
    if (query) {
        Object.entries(query).forEach(([key, value]) => {
            if (value) url.searchParams.set(key, value);
        });
    }
    return url.toString();
}

function toErrorCode(input: string | undefined, status: number): NotebookApiErrorCode {
    const code = (input || "").toUpperCase();
    if (code.includes("MANAGED_BY_PLATFORM")) return "MANAGED_BY_PLATFORM";
    if (code.includes("CAPABILITY_DISABLED")) return "CAPABILITY_DISABLED";
    if (code.includes("CAPABILITY_EXPIRED")) return "CAPABILITY_EXPIRED";
    if (code.includes("QUOTA_EXCEEDED")) return "QUOTA_EXCEEDED";
    if (code.includes("INVALID_CONTEXT")) return "INVALID_CONTEXT";
    if (code.includes("FORBIDDEN_ROLE")) return "FORBIDDEN_ROLE";
    if (code.includes("VALIDATION_ERROR")) return "VALIDATION_ERROR";
    if (code.includes("UNAUTHORIZED")) return "UNAUTHORIZED";
    if (code.includes("INVALID_AUTH_TOKEN")) return "INVALID_AUTH_TOKEN";
    if (code.includes("INVALID_TOKEN_TYPE")) return "INVALID_TOKEN_TYPE";
    if (code.includes("NOT_FOUND")) return "NOT_FOUND";
    if (code.includes("NO_VALID_HUB_TOKEN")) return "NO_VALID_HUB_TOKEN";
    if (status === 408 || status === 504) return "TIMEOUT";
    if (status === 429) return "QUOTA_EXCEEDED";
    if (status === 401) return "INVALID_AUTH_TOKEN";
    if (status === 422) return "INVALID_CONTEXT";
    if (status === 403) return "FORBIDDEN_ROLE";
    return "UNKNOWN";
}

function isLikelyHubJwtToken(token: string): boolean {
    const trimmed = token.trim();
    if (!trimmed.startsWith("eyJ")) return false;
    const parts = trimmed.split(".");
    if (parts.length !== 3) return false;
    return parts.every((part) => part.length > 0);
}

function assertHubJwtToken(auth: NotebookApiAuth, context?: { method: string; path: string; url: string; requestBody?: unknown }): void {
    if (!auth.accessToken || !isLikelyHubJwtToken(auth.accessToken)) {
        if (context) {
            setNotebookRequestDebugSnapshot(createNotebookRequestDebugSnapshot({
                auth,
                method: context.method,
                path: context.path,
                url: context.url,
                requestBody: context.requestBody,
                error: {
                    message: "Notebook 驗證失敗，缺少可驗證的 Hub/Supabase JWT",
                    code: "NO_VALID_HUB_TOKEN",
                    status: 401,
                },
            }));
        }
        throw new NotebookServiceError(
            "Notebook 驗證失敗，缺少可驗證的 Hub/Supabase JWT",
            401,
            "NO_VALID_HUB_TOKEN",
            null,
        );
    }
}

async function readError(response: Response): Promise<NotebookServiceError> {
    let payload: ErrorPayload | null = null;
    try {
        payload = (await response.json()) as ErrorPayload;
    } catch {
        payload = null;
    }
    const message = payload?.message || payload?.error || response.statusText || "Request failed";
    const code = toErrorCode(payload?.code || payload?.message || payload?.error, response.status);
    return new NotebookServiceError(message, response.status, code, payload);
}

async function sendNotebookRequest<T>(params: {
    auth: NotebookApiAuth;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
}): Promise<T> {
    const url = buildUrl(params.path, params.auth, params.query);
    assertHubJwtToken(params.auth, {
        method: params.method,
        path: params.path,
        url,
        requestBody: params.body,
    });
    setNotebookRequestDebugSnapshot(createNotebookRequestDebugSnapshot({
        auth: params.auth,
        method: params.method,
        path: params.path,
        url,
        requestBody: params.body,
    }));

    let response: Response;
    try {
        response = await fetchWithDesktopSupport(url, {
            method: params.method,
            cache: params.method === "GET" ? "no-store" : undefined,
            headers: {
                Authorization: `Bearer ${params.auth.accessToken}`,
                ...(params.method !== "GET" ? { "Content-Type": "application/json" } : {}),
            },
            ...(params.body ? { body: JSON.stringify(params.body) } : {}),
        });
    } catch (error) {
        setNotebookRequestDebugSnapshot(createNotebookRequestDebugSnapshot({
            auth: params.auth,
            method: params.method,
            path: params.path,
            url,
            requestBody: params.body,
            error: {
                message: error instanceof Error ? error.message : String(error),
                code: "NETWORK_ERROR",
                status: 0,
            },
        }));
        throw error;
    }

    if (!response.ok) {
        const serviceError = await readError(response);
        setNotebookRequestDebugSnapshot(createNotebookRequestDebugSnapshot({
            auth: params.auth,
            method: params.method,
            path: params.path,
            url,
            requestBody: params.body,
            response: {
                ok: false,
                status: response.status,
                statusText: response.statusText,
                body: sanitizeDebugValue(serviceError.details),
            },
            error: {
                message: serviceError.message,
                code: serviceError.code,
                status: serviceError.status,
            },
        }));
        throw serviceError;
    }

    const data = (await response.json()) as T;
    setNotebookRequestDebugSnapshot(createNotebookRequestDebugSnapshot({
        auth: params.auth,
        method: params.method,
        path: params.path,
        url,
        requestBody: params.body,
        response: {
            ok: true,
            status: response.status,
            statusText: response.statusText,
            body: sanitizeDebugValue(data),
        },
    }));
    return data;
}

async function getJson<T>(auth: NotebookApiAuth, path: string, query?: Record<string, string>): Promise<T> {
    return sendNotebookRequest<T>({ auth, method: "GET", path, query });
}

async function postJson<T>(auth: NotebookApiAuth, path: string, body: Record<string, unknown>): Promise<T> {
    return sendNotebookRequest<T>({ auth, method: "POST", path, body });
}

async function patchJson<T>(auth: NotebookApiAuth, path: string, body: Record<string, unknown>): Promise<T> {
    return sendNotebookRequest<T>({ auth, method: "PATCH", path, body });
}

async function deleteRequest<T>(auth: NotebookApiAuth, path: string): Promise<T> {
    return sendNotebookRequest<T>({ auth, method: "DELETE", path });
}

export async function getNotebookItems(
    auth: NotebookApiAuth,
    input?: {
        q?: string;
        filter?: "all" | "knowledge" | "note";
        scope?: "personal" | "company" | "both";
        is_indexable?: boolean;
        item_type?: "text" | "file";
        status?: "active" | "deleted";
        cursor?: string;
        limit?: number;
    },
): Promise<GetNotebookItemsResponse> {
    const query: Record<string, string> = {};
    if (input?.q) query.q = input.q;
    if (input?.filter) query.filter = input.filter;
    if (input?.scope) query.scope = input.scope;
    if (typeof input?.is_indexable === "boolean") query.is_indexable = String(input.is_indexable);
    if (input?.item_type) query.item_type = input.item_type;
    if (input?.status) query.status = input.status;
    if (input?.cursor) query.cursor = input.cursor;
    if (input?.limit) query.limit = String(input.limit);
    return getJson<GetNotebookItemsResponse>(auth, "/notebook/items", query);
}

export async function getNotebookCapabilities(auth: NotebookApiAuth): Promise<NotebookCapabilitiesResponse> {
    return getJson<NotebookCapabilitiesResponse>(auth, "/me/capabilities");
}

export async function getCompanyNotebookAiSettings(auth: NotebookApiAuth): Promise<CompanyNotebookAiSettingsResponse> {
    return getJson<CompanyNotebookAiSettingsResponse>(auth, "/company/settings/notebook-ai");
}

export async function getCompanyTranslationSettings(auth: NotebookApiAuth): Promise<CompanyTranslationSettingsResponse> {
    return getJson<CompanyTranslationSettingsResponse>(auth, "/company/settings/translation");
}

export async function createNotebookItem(
    auth: NotebookApiAuth,
    input: { title: string; content_markdown: string; item_type?: "text" | "file"; is_indexable?: boolean; chunk_strategy?: string; chunk_size?: number; chunk_separator?: string },
): Promise<{ item: NotebookItemDto }> {
    return postJson<{ item: NotebookItemDto }>(auth, "/notebook/items", input);
}

export async function updateNotebookItem(
    auth: NotebookApiAuth,
    itemId: string,
    input: {
        title?: string;
        content_markdown?: string;
        is_indexable?: boolean;
        status?: "active" | "deleted";
        revision?: number;
        chunk_strategy?: string;
        chunk_size?: number;
        chunk_separator?: string;
    },
): Promise<{ item: NotebookItemDto; conflict: boolean }> {
    return patchJson<{ item: NotebookItemDto; conflict: boolean }>(auth, `/notebook/items/${encodeURIComponent(itemId)}`, input);
}

export async function deleteNotebookItem(
    auth: NotebookApiAuth,
    itemId: string,
): Promise<{ ok: boolean; revision: number }> {
    return deleteRequest<{ ok: boolean; revision: number }>(auth, `/notebook/items/${encodeURIComponent(itemId)}`);
}

export async function attachNotebookFile(
    auth: NotebookApiAuth,
    itemId: string,
    input: {
        matrix_media_mxc: string;
        matrix_media_name?: string;
        matrix_media_mime?: string;
        matrix_media_size?: number;
        is_indexable?: boolean;
        chunk_strategy?: string;
        chunk_size?: number;
        chunk_separator?: string;
    },
): Promise<{ item: NotebookItemDto; index_job: { id: string } | null }> {
    return postJson<{ item: NotebookItemDto; index_job: { id: string } | null }>(auth, `/notebook/items/${encodeURIComponent(itemId)}/files`, input);
}

export async function deleteNotebookItemFile(
    auth: NotebookApiAuth,
    itemId: string,
    fileId: string,
): Promise<{ ok: boolean; item: NotebookItemDto }> {
    return deleteRequest<{ ok: boolean; item: NotebookItemDto }>(
        auth,
        `/notebook/items/${encodeURIComponent(itemId)}/files/${encodeURIComponent(fileId)}`,
    );
}

export async function getNotebookItemIndexStatus(
    auth: NotebookApiAuth,
    itemId: string,
): Promise<{ item_id: string; index_status: NotebookItemDto["index_status"]; index_error?: string | null }> {
    return getJson<{ item_id: string; index_status: NotebookItemDto["index_status"]; index_error?: string | null }>(
        auth,
        `/notebook/items/${encodeURIComponent(itemId)}/index-status`,
    );
}

export async function reindexNotebookItem(
    auth: NotebookApiAuth,
    itemId: string,
): Promise<{ item: NotebookItemDto; index_job?: { id: string } | null }> {
    return postJson<{ item: NotebookItemDto; index_job?: { id: string } | null }>(
        auth,
        `/notebook/items/${encodeURIComponent(itemId)}/reindex`,
        {},
    );
}

export async function retryNotebookIndexJob(
    auth: NotebookApiAuth,
    jobId: string,
): Promise<{
    job: { id: string; status?: string };
    item?: NotebookItemDto;
    item_id?: string;
    index_status?: NotebookItemDto["index_status"];
    index_error?: string | null;
}> {
    return postJson(
        auth,
        `/notebook/index/jobs/${encodeURIComponent(jobId)}/retry`,
        {},
    );
}

export async function getNotebookItemParsedPreview(
    auth: NotebookApiAuth,
    itemId: string,
    input?: { limit?: number; chars?: number },
): Promise<{
    item_id: string;
    index_status: NotebookItemDto["index_status"];
    index_error?: string | null;
    preview: {
        text: string;
        truncated: boolean;
        chunk_count_sampled: number;
        chunk_count_total: number;
        total_chars: number;
        total_tokens: number;
    };
}> {
    const query: Record<string, string> = {};
    if (input?.limit) query.limit = String(input.limit);
    if (input?.chars) query.chars = String(input.chars);
    return getJson(auth, `/notebook/items/${encodeURIComponent(itemId)}/parsed-preview`, query);
}

export async function getNotebookItemChunks(
    auth: NotebookApiAuth,
    itemId: string,
    input?: { limit?: number },
): Promise<{
    item_id: string;
    index_status: NotebookItemDto["index_status"];
    index_error?: string | null;
    chunks: NotebookChunkDto[];
    total: number;
}> {
    const query: Record<string, string> = {};
    if (input?.limit) query.limit = String(input.limit);
    return getJson(auth, `/notebook/items/${encodeURIComponent(itemId)}/chunks`, query);
}

export async function assistFromContext(
    auth: NotebookApiAuth,
    input: AssistFromContextRequest,
): Promise<NotebookAssistResponseDto> {
    const path = "/chat/assist/from-context";
    const url = buildUrl(path, auth);
    assertHubJwtToken(auth, {
        method: "POST",
        path,
        url,
        requestBody: input,
    });
    setNotebookRequestDebugSnapshot(createNotebookRequestDebugSnapshot({
        auth,
        method: "POST",
        path,
        url,
        requestBody: input,
    }));
    const response = await fetchWithDesktopSupport(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            "Content-Type": "application/json",
            ...(auth.matrixAccessToken ? { "X-Matrix-Access-Token": auth.matrixAccessToken } : {}),
        },
        body: JSON.stringify(input),
    });
    if (!response.ok) {
        const serviceError = await readError(response);
        setNotebookRequestDebugSnapshot(createNotebookRequestDebugSnapshot({
            auth,
            method: "POST",
            path,
            url,
            requestBody: input,
            response: {
                ok: false,
                status: response.status,
                statusText: response.statusText,
                body: sanitizeDebugValue(serviceError.details),
            },
            error: {
                message: serviceError.message,
                code: serviceError.code,
                status: serviceError.status,
            },
        }));
        throw serviceError;
    }
    const data = (await response.json()) as NotebookAssistResponseDto;
    setNotebookRequestDebugSnapshot(createNotebookRequestDebugSnapshot({
        auth,
        method: "POST",
        path,
        url,
        requestBody: input,
        response: {
            ok: true,
            status: response.status,
            statusText: response.statusText,
            body: sanitizeDebugValue(data),
        },
    }));
    return data;
}

export async function assistQuery(
    auth: NotebookApiAuth,
    input: { room_id: string; query: string; top_k?: number; response_lang?: string; knowledge_scope?: "personal" | "company" | "both" },
): Promise<NotebookAssistResponseDto> {
    return postJson<NotebookAssistResponseDto>(auth, "/chat/assist/query", input);
}

export async function getCompanyKnowledgeItems(
    auth: NotebookApiAuth,
): Promise<GetNotebookItemsResponse> {
    return getJson<GetNotebookItemsResponse>(auth, "/company/knowledge/items");
}

export async function pushNotebookSync(
    auth: NotebookApiAuth,
    input: NotebookSyncPushRequest,
): Promise<NotebookSyncPushResponse> {
    return postJson<NotebookSyncPushResponse>(auth, "/notebook/sync/push", input);
}
