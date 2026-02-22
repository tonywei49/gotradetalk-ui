import { notebookApiBaseUrl } from "../config";

export type NotebookApiErrorCode =
    | "CAPABILITY_DISABLED"
    | "INVALID_CONTEXT"
    | "FORBIDDEN_ROLE"
    | "VALIDATION_ERROR"
    | "UNAUTHORIZED"
    | "INVALID_AUTH_TOKEN"
    | "NOT_FOUND"
    | "NO_VALID_HUB_TOKEN"
    | "UNKNOWN";

export class NotebookServiceError extends Error {
    public readonly status: number;

    public readonly code: NotebookApiErrorCode;

    constructor(message: string, status: number, code: NotebookApiErrorCode) {
        super(message);
        this.name = "NotebookServiceError";
        this.status = status;
        this.code = code;
    }
}

export type NotebookApiAuth = {
    accessToken: string;
    apiBaseUrl?: string | null;
    hsUrl?: string | null;
    matrixUserId?: string | null;
};

export type NotebookItemDto = {
    id: string;
    title: string | null;
    content_markdown: string | null;
    item_type: "text" | "file";
    index_status: "pending" | "running" | "success" | "failed" | "skipped";
    index_error?: string | null;
    updated_at: string;
    created_at: string;
    matrix_media_name?: string | null;
    files?: NotebookItemFileDto[];
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

export type AssistFromContextRequest = {
    room_id: string;
    anchor_event_id: string;
    window_size?: number;
    response_lang?: string;
};

export type NotebookAssistSourceDto = {
    item_id: string;
    title: string | null;
    snippet: string;
    source_locator?: string | null;
    score?: number;
};

export type NotebookAssistCitationDto = {
    source_id: string;
    locator?: string | null;
};

export type NotebookAssistResponseDto = {
    answer: string;
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
    if (code === "CAPABILITY_DISABLED") return "CAPABILITY_DISABLED";
    if (code === "INVALID_CONTEXT") return "INVALID_CONTEXT";
    if (code === "FORBIDDEN_ROLE") return "FORBIDDEN_ROLE";
    if (code === "VALIDATION_ERROR") return "VALIDATION_ERROR";
    if (code === "UNAUTHORIZED") return "UNAUTHORIZED";
    if (code === "INVALID_AUTH_TOKEN") return "INVALID_AUTH_TOKEN";
    if (code === "NOT_FOUND") return "NOT_FOUND";
    if (code === "NO_VALID_HUB_TOKEN") return "NO_VALID_HUB_TOKEN";
    if (status === 401) return "INVALID_AUTH_TOKEN";
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

function assertHubJwtToken(auth: NotebookApiAuth): void {
    if (!auth.accessToken || !isLikelyHubJwtToken(auth.accessToken)) {
        throw new NotebookServiceError(
            "Notebook 驗證失敗，缺少可驗證的 Hub/Supabase JWT",
            401,
            "NO_VALID_HUB_TOKEN",
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
    const code = toErrorCode(payload?.code, response.status);
    return new NotebookServiceError(message, response.status, code);
}

async function getJson<T>(auth: NotebookApiAuth, path: string, query?: Record<string, string>): Promise<T> {
    assertHubJwtToken(auth);
    const response = await fetch(buildUrl(path, auth, query), {
        method: "GET",
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${auth.accessToken}`,
        },
    });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
}

async function postJson<T>(auth: NotebookApiAuth, path: string, body: Record<string, unknown>): Promise<T> {
    assertHubJwtToken(auth);
    const response = await fetch(buildUrl(path, auth), {
        method: "POST",
        headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
}

async function patchJson<T>(auth: NotebookApiAuth, path: string, body: Record<string, unknown>): Promise<T> {
    assertHubJwtToken(auth);
    const response = await fetch(buildUrl(path, auth), {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
}

async function deleteRequest<T>(auth: NotebookApiAuth, path: string): Promise<T> {
    assertHubJwtToken(auth);
    const response = await fetch(buildUrl(path, auth), {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${auth.accessToken}`,
        },
    });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
}

export async function getNotebookItems(
    auth: NotebookApiAuth,
    input?: { q?: string; item_type?: "text" | "file"; status?: "active" | "deleted"; cursor?: string; limit?: number },
): Promise<GetNotebookItemsResponse> {
    const query: Record<string, string> = {};
    if (input?.q) query.q = input.q;
    if (input?.item_type) query.item_type = input.item_type;
    if (input?.status) query.status = input.status;
    if (input?.cursor) query.cursor = input.cursor;
    if (input?.limit) query.limit = String(input.limit);
    return getJson<GetNotebookItemsResponse>(auth, "/notebook/items", query);
}

export async function getNotebookCapabilities(auth: NotebookApiAuth): Promise<NotebookCapabilitiesResponse> {
    return getJson<NotebookCapabilitiesResponse>(auth, "/me/capabilities");
}

export async function createNotebookItem(
    auth: NotebookApiAuth,
    input: { title: string; content_markdown: string; item_type?: "text" | "file"; is_indexable?: boolean },
): Promise<{ item: NotebookItemDto }> {
    return postJson<{ item: NotebookItemDto }>(auth, "/notebook/items", input);
}

export async function updateNotebookItem(
    auth: NotebookApiAuth,
    itemId: string,
    input: { title?: string; content_markdown?: string; is_indexable?: boolean; status?: "active" | "deleted"; revision?: number },
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

export async function assistFromContext(
    auth: NotebookApiAuth,
    input: AssistFromContextRequest,
): Promise<NotebookAssistResponseDto> {
    return postJson<NotebookAssistResponseDto>(auth, "/chat/assist/from-context", input);
}

export async function assistQuery(
    auth: NotebookApiAuth,
    input: { room_id: string; query: string; top_k?: number; response_lang?: string },
): Promise<NotebookAssistResponseDto> {
    return postJson<NotebookAssistResponseDto>(auth, "/chat/assist/query", input);
}

export async function pushNotebookSync(
    auth: NotebookApiAuth,
    input: NotebookSyncPushRequest,
): Promise<NotebookSyncPushResponse> {
    return postJson<NotebookSyncPushResponse>(auth, "/notebook/sync/push", input);
}
