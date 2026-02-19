import { hubApiBaseUrl } from "../config";

export type NotebookApiErrorCode =
    | "CAPABILITY_DISABLED"
    | "INVALID_CONTEXT"
    | "FORBIDDEN_ROLE"
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
    hsUrl?: string | null;
    matrixUserId?: string | null;
};

export type NotebookItemDto = {
    id: string;
    title: string;
    content_markdown: string;
    item_type: "text" | "file";
    index_status: "pending" | "running" | "success" | "failed" | "skipped";
    index_error?: string | null;
    updated_at: string;
    created_at: string;
    matrix_media_name?: string | null;
};

export type GetNotebookItemsResponse = {
    items: NotebookItemDto[];
};

export type AssistFromContextRequest = {
    room_id: string;
    anchor_event_id: string;
    window_size?: number;
};

export type NotebookAssistResponseDto = {
    answer: string;
    sources: Array<{
        itemId: string;
        title: string;
        snippet: string;
        locator?: string | null;
    }>;
    citations: Array<{
        itemId: string;
        title: string;
        locator?: string | null;
    }>;
    confidence: number;
    trace_id?: string;
    traceId?: string;
};

export type NotebookSyncPushRequest = {
    ops: Array<{
        client_op_id: string;
        entity_type: "item" | "item_file";
        entity_id: string;
        op_type: "create" | "update" | "delete";
        op_payload: Record<string, unknown>;
    }>;
};

export type NotebookSyncPushResponse = {
    accepted: number;
    rejected: number;
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
    const base = normalizeBaseUrl(hubApiBaseUrl);
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
    if (status === 403) return "FORBIDDEN_ROLE";
    return "UNKNOWN";
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

async function deleteRequest(auth: NotebookApiAuth, path: string): Promise<void> {
    const response = await fetch(buildUrl(path, auth), {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${auth.accessToken}`,
        },
    });
    if (!response.ok) throw await readError(response);
}

export async function getNotebookItems(auth: NotebookApiAuth, keyword?: string): Promise<GetNotebookItemsResponse> {
    return getJson<GetNotebookItemsResponse>(auth, "/notebook/items", { keyword: keyword ?? "" });
}

export async function createNotebookItem(
    auth: NotebookApiAuth,
    input: { title: string; content_markdown: string; item_type?: "text" | "file" },
): Promise<NotebookItemDto> {
    return postJson<NotebookItemDto>(auth, "/notebook/items", input);
}

export async function updateNotebookItem(
    auth: NotebookApiAuth,
    itemId: string,
    input: { title?: string; content_markdown?: string },
): Promise<NotebookItemDto> {
    return patchJson<NotebookItemDto>(auth, `/notebook/items/${encodeURIComponent(itemId)}`, input);
}

export async function deleteNotebookItem(auth: NotebookApiAuth, itemId: string): Promise<void> {
    await deleteRequest(auth, `/notebook/items/${encodeURIComponent(itemId)}`);
}

export async function attachNotebookFile(
    auth: NotebookApiAuth,
    itemId: string,
    input: { file_name: string },
): Promise<NotebookItemDto> {
    return postJson<NotebookItemDto>(auth, `/notebook/items/${encodeURIComponent(itemId)}/files`, input);
}

export async function getNotebookItemIndexStatus(
    auth: NotebookApiAuth,
    itemId: string,
): Promise<{ index_status: NotebookItemDto["index_status"]; index_error?: string | null }> {
    return getJson<{ index_status: NotebookItemDto["index_status"]; index_error?: string | null }>(
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
    input: { room_id: string; query: string },
): Promise<NotebookAssistResponseDto> {
    return postJson<NotebookAssistResponseDto>(auth, "/chat/assist/query", input);
}

export async function pushNotebookSync(
    auth: NotebookApiAuth,
    input: NotebookSyncPushRequest,
): Promise<NotebookSyncPushResponse> {
    return postJson<NotebookSyncPushResponse>(auth, "/notebook/sync/push", input);
}
