import { hubApiBaseUrl } from "../config";
import type {
    HubCapabilitiesResponse,
    HubClientLoginResponse,
    HubClientSignupPayload,
    HubMatrixCredentials,
    HubMeResponse,
    HubStaffSessionExchangeResponse,
    HubSupabaseSession,
} from "./types";

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

function isAbsoluteUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
}

function joinUrl(base: string, path: string): string {
    const normalizedBase = normalizeBaseUrl(base);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (isAbsoluteUrl(normalizedBase)) {
        return `${normalizedBase}${normalizedPath}`;
    }
    return `${normalizedBase}${normalizedPath}`;
}

function withQuery(url: string, params: Record<string, string>): string {
    const search = new URLSearchParams(params).toString();
    if (!search) return url;
    return `${url}?${search}`;
}

async function readResponseMessage(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        try {
            const data = (await response.json()) as { message?: string; error?: string };
            if (data?.message) return data.message;
            if (data?.error) return data.error;
        } catch {
            // fall through
        }
    }
    const text = await response.text();
    return text || `Request failed (${response.status})`;
}

async function postJson<T>(
    url: string,
    body: Record<string, unknown>,
    accessToken?: string,
    extraHeaders?: Record<string, string>,
): Promise<T> {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(extraHeaders || {}),
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }

    return (await response.json()) as T;
}

export async function hubClientLogin(
    account: string,
    password: string,
    accessToken?: string,
): Promise<HubClientLoginResponse> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    return postJson<HubClientLoginResponse>(`${hubBaseUrl}/client/login`, {
        account,
        password,
    }, accessToken);
}

export async function hubClientProvision(
    accessToken: string,
    payload: HubClientSignupPayload,
): Promise<{ matrix: HubMatrixCredentials }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    return postJson<{ matrix: HubMatrixCredentials }>(
        `${hubBaseUrl}/client/signup-provision`,
        payload,
        accessToken,
    );
}

export async function hubClientSetPassword(accessToken: string, password: string): Promise<void> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    await postJson<Record<string, unknown>>(
        `${hubBaseUrl}/client/set-password`,
        { password },
        accessToken,
    );
}

export async function hubClientResetPassword(accessToken: string, password: string): Promise<void> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    await postJson<Record<string, unknown>>(
        `${hubBaseUrl}/client/reset-password`,
        { password },
        accessToken,
    );
}

export type HubStaffPasswordStateResponse = {
    password_state: string;
};

const staffSessionExchangeCandidates = [
    "/staff/session/exchange",
    "/staff/auth/session/exchange",
    "/auth/staff/session/exchange",
] as const;

function isLikelyJwtToken(token: string): boolean {
    const trimmed = token.trim();
    if (!trimmed.startsWith("eyJ")) return false;
    const parts = trimmed.split(".");
    return parts.length === 3 && parts.every((part) => part.length > 0);
}

function normalizeHubSession(input: HubSupabaseSession | null | undefined): HubSupabaseSession | null {
    if (!input?.access_token || !isLikelyJwtToken(input.access_token)) return null;
    return {
        access_token: input.access_token,
        refresh_token: input.refresh_token || "",
        expires_at: input.expires_at,
    };
}

export async function hubStaffExchangeSession(params: {
    matrixAccessToken: string;
    hsUrl: string;
    password: string;
    matrixUserId?: string | null;
}): Promise<HubSupabaseSession> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    let lastErrorMessage = "NO_VALID_HUB_TOKEN";

    for (const path of staffSessionExchangeCandidates) {
        const url = joinUrl(hubBaseUrl, path);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${params.matrixAccessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    hs_url: params.hsUrl,
                    password: params.password,
                    matrix_user_id: params.matrixUserId ?? undefined,
                }),
            });
            if (!response.ok) {
                const message = await readResponseMessage(response);
                throw new Error(message || `Request failed (${response.status})`);
            }
            const payload = (await response.json()) as HubStaffSessionExchangeResponse;
            const session = normalizeHubSession(payload.supabase);
            if (!session) {
                throw new Error("NO_VALID_HUB_TOKEN");
            }
            return session;
        } catch (error) {
            if (error instanceof Error && error.message) {
                lastErrorMessage = error.message;
            }
            // try next candidate path
        }
    }

    throw new Error(lastErrorMessage || "NO_VALID_HUB_TOKEN");
}

export async function hubStaffPasswordState(
    accessToken: string,
    hsUrl: string,
): Promise<HubStaffPasswordStateResponse> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = withQuery(joinUrl(hubBaseUrl, "/staff/password-state/self"), { hs_url: hsUrl });
    return getJson<HubStaffPasswordStateResponse>(url, accessToken);
}

export async function hubStaffActivatePasswordState(accessToken: string, hsUrl: string): Promise<void> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    await postJson<Record<string, unknown>>(
        `${hubBaseUrl}/staff/password-state/activate-self`,
        { hs_url: hsUrl },
        accessToken,
    );
}

export async function hubStaffLocaleSelf(
    accessToken: string,
    hsUrl: string,
): Promise<{ locale: string | null }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = withQuery(joinUrl(hubBaseUrl, "/staff/locale/self"), { hs_url: hsUrl });
    return getJson<{ locale: string | null }>(url, accessToken);
}

export async function hubStaffUpdateLocaleSelf(
    accessToken: string,
    hsUrl: string,
    locale: string,
): Promise<void> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    await postJson<Record<string, unknown>>(
        `${hubBaseUrl}/staff/locale/self`,
        { hs_url: hsUrl, locale },
        accessToken,
    );
}

export async function hubStaffTranslationLocaleSelf(
    accessToken: string,
    hsUrl: string,
): Promise<{ translation_locale: string | null }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = withQuery(joinUrl(hubBaseUrl, "/staff/translation-locale/self"), { hs_url: hsUrl });
    return getJson<{ translation_locale: string | null }>(url, accessToken);
}

export async function hubStaffUpdateTranslationLocaleSelf(
    accessToken: string,
    hsUrl: string,
    translationLocale: string,
): Promise<void> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    await postJson<Record<string, unknown>>(
        `${hubBaseUrl}/staff/translation-locale/self`,
        { hs_url: hsUrl, translation_locale: translationLocale },
        accessToken,
    );
}

export async function hubGetMe(params: {
    accessToken: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
}): Promise<HubMeResponse> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = {};
    if (params.hsUrl) {
        query.hs_url = params.hsUrl;
    }
    if (params.matrixUserId) {
        query.matrix_user_id = params.matrixUserId;
    }
    const url = Object.keys(query).length ? withQuery(joinUrl(hubBaseUrl, "/me"), query) : joinUrl(hubBaseUrl, "/me");
    return getJson<HubMeResponse>(url, params.accessToken);
}

export async function hubGetCapabilities(params: {
    accessToken: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
}): Promise<HubCapabilitiesResponse> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = {};
    if (params.hsUrl) {
        query.hs_url = params.hsUrl;
    }
    if (params.matrixUserId) {
        query.matrix_user_id = params.matrixUserId;
    }
    const url = Object.keys(query).length
        ? withQuery(joinUrl(hubBaseUrl, "/me/capabilities"), query)
        : joinUrl(hubBaseUrl, "/me/capabilities");
    return getJson<HubCapabilitiesResponse>(url, params.accessToken);
}

export async function hubMeUpdateLocale(
    accessToken: string,
    locale: string,
    options?: { hsUrl?: string | null; matrixUserId?: string | null },
): Promise<{ locale: string | null }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = { locale };
    if (options?.hsUrl) {
        query.hs_url = options.hsUrl;
    }
    if (options?.matrixUserId) {
        query.matrix_user_id = options.matrixUserId;
    }
    const url = withQuery(joinUrl(hubBaseUrl, "/me/locale"), query);
    return postJson<{ locale: string | null }>(url, { locale }, accessToken);
}

export async function hubMeUpdateTranslationLocale(
    accessToken: string,
    translationLocale: string,
    options?: { hsUrl?: string | null; matrixUserId?: string | null },
): Promise<{ translation_locale: string | null }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = { translation_locale: translationLocale };
    if (options?.hsUrl) {
        query.hs_url = options.hsUrl;
    }
    if (options?.matrixUserId) {
        query.matrix_user_id = options.matrixUserId;
    }
    const url = withQuery(joinUrl(hubBaseUrl, "/me/translation-locale"), query);
    return postJson<{ translation_locale: string | null }>(
        url,
        { translation_locale: translationLocale },
        accessToken,
    );
}

export type HubTranslateResponse = {
    translation: string;
    model: string;
    target_lang: string;
    input_chars: number;
    output_chars: number;
    latency_ms: number;
};

export async function hubTranslate(params: {
    accessToken: string;
    text: string;
    targetLang: string;
    sourceLangHint?: string;
    chatLinkId?: string;
    roomId?: string;
    messageId?: string;
    sourceMatrixUserId?: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
}): Promise<HubTranslateResponse> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = {};
    if (params.hsUrl) {
        query.hs_url = params.hsUrl;
    }
    if (params.matrixUserId) {
        query.matrix_user_id = params.matrixUserId;
    }
    const url = Object.keys(query).length ? withQuery(joinUrl(hubBaseUrl, "/translate"), query) : joinUrl(hubBaseUrl, "/translate");
    return postJson<HubTranslateResponse>(
        url,
        {
            text: params.text,
            target_lang: params.targetLang,
            source_lang_hint: params.sourceLangHint,
            chat_link_id: params.chatLinkId,
            room_id: params.roomId,
            message_id: params.messageId,
            source_matrix_user_id: params.sourceMatrixUserId,
        },
        params.accessToken,
    );
}

export type ChatSummaryJobItem = {
    id: string;
    target_label: string;
    room_id: string | null;
    from_date: string;
    to_date: string;
    status: "processing" | "completed" | "failed";
    created_at: string;
    updated_at: string;
    has_content: boolean;
    progress_stage?: string | null;
    progress_current?: number | null;
    progress_total?: number | null;
    progress_message?: string | null;
    error_message?: string | null;
};

export type ChatSummaryJobDetail = {
    id: string;
    target_label: string;
    room_id: string | null;
    from_date: string;
    to_date: string;
    status: "processing" | "completed" | "failed";
    created_at: string;
    updated_at: string;
    summary_text: string;
    progress_stage?: string | null;
    progress_current?: number | null;
    progress_total?: number | null;
    progress_message?: string | null;
    error_message?: string | null;
};

function toSummaryApiDateTime(value: string): string {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    const normalized = trimmed.replace(/\//g, "-").replace(" ", "T");
    const localMatch = normalized.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(?::(\d{2}))?(?::(\d{2}))?)?$/,
    );
    if (localMatch) {
        const year = Number(localMatch[1]);
        const month = Number(localMatch[2]);
        const day = Number(localMatch[3]);
        const hour = Number(localMatch[4] || "0");
        const minute = Number(localMatch[5] || "0");
        const second = Number(localMatch[6] || "0");
        const localDate = new Date(year, month - 1, day, hour, minute, second, 0);
        if (!Number.isNaN(localDate.getTime())) {
            return localDate.toISOString();
        }
    }
    // Fallback for ISO strings with timezone / other parseable formats.
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString();
}

export async function createChatSummaryJob(params: {
    accessToken: string;
    targetLabel: string;
    roomId?: string | null;
    fromDate: string;
    toDate: string;
    summaryDirection?: string | null;
    summaryCustomRequirement?: string | null;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<{ id: string; status: string; target_label: string; from_date: string; to_date: string; created_at: string }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;
    const url = Object.keys(query).length ? withQuery(joinUrl(hubBaseUrl, "/chat/summary/jobs"), query) : joinUrl(hubBaseUrl, "/chat/summary/jobs");
    const fromDate = toSummaryApiDateTime(params.fromDate);
    const toDate = toSummaryApiDateTime(params.toDate);
    return postJson(url, {
        target_label: params.targetLabel,
        room_id: params.roomId || null,
        from_date: fromDate,
        to_date: toDate,
        summary_direction: params.summaryDirection || null,
        summary_custom_requirement: params.summaryCustomRequirement || null,
    }, params.accessToken, params.matrixAccessToken ? { "X-Matrix-Access-Token": params.matrixAccessToken } : undefined);
}

export async function listChatSummaryJobs(params: {
    accessToken: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<{ items: ChatSummaryJobItem[] }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;
    const url = Object.keys(query).length ? withQuery(joinUrl(hubBaseUrl, "/chat/summary/jobs"), query) : joinUrl(hubBaseUrl, "/chat/summary/jobs");
    return getJson<{ items: ChatSummaryJobItem[] }>(url, params.accessToken, params.matrixAccessToken ? { "X-Matrix-Access-Token": params.matrixAccessToken } : undefined);
}

export async function deleteChatSummaryJob(params: {
    accessToken: string;
    id: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<{ ok: boolean }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;
    const base = joinUrl(hubBaseUrl, `/chat/summary/jobs/${encodeURIComponent(params.id)}`);
    const url = Object.keys(query).length ? withQuery(base, query) : base;
    const response = await fetch(url, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
            ...(params.matrixAccessToken ? { "X-Matrix-Access-Token": params.matrixAccessToken } : {}),
        },
    });
    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }
    return (await response.json()) as { ok: boolean };
}

export async function retryChatSummaryJob(params: {
    accessToken: string;
    id: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<{ ok: boolean; id: string; status: string }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;
    const base = joinUrl(hubBaseUrl, `/chat/summary/jobs/${encodeURIComponent(params.id)}/retry`);
    const url = Object.keys(query).length ? withQuery(base, query) : base;
    return postJson<{ ok: boolean; id: string; status: string }>(
        url,
        {},
        params.accessToken,
        params.matrixAccessToken ? { "X-Matrix-Access-Token": params.matrixAccessToken } : undefined,
    );
}

export async function getChatSummaryJob(params: {
    accessToken: string;
    id: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<ChatSummaryJobDetail> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;
    const base = joinUrl(hubBaseUrl, `/chat/summary/jobs/${encodeURIComponent(params.id)}`);
    const url = Object.keys(query).length ? withQuery(base, query) : base;
    return getJson<ChatSummaryJobDetail>(url, params.accessToken, params.matrixAccessToken ? { "X-Matrix-Access-Token": params.matrixAccessToken } : undefined);
}

export async function downloadChatSummaryJob(params: {
    accessToken: string;
    id: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<Blob> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;
    const base = joinUrl(hubBaseUrl, `/chat/summary/jobs/${encodeURIComponent(params.id)}/download`);
    const url = Object.keys(query).length ? withQuery(base, query) : base;
    const response = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
            ...(params.matrixAccessToken ? { "X-Matrix-Access-Token": params.matrixAccessToken } : {}),
        },
    });
    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }
    return response.blob();
}

export type HubTaskItem = {
    id: string;
    title: string;
    content: string;
    statusId: string;
    remindAt: string | null;
    remindState: "pending" | "snoozed" | "notified";
    snoozedUntil: string | null;
    roomId: string | null;
    roomNameSnapshot: string | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
};

export type HubTaskPayload = {
    title?: string;
    content?: string;
    statusId?: string;
    remindAt?: string | null;
    remindState?: "pending" | "snoozed" | "notified";
    snoozedUntil?: string | null;
    roomId?: string | null;
    roomNameSnapshot?: string | null;
    createdBy?: string | null;
    completedAt?: string | null;
};

function buildHubAuthQuery(params?: { hsUrl?: string | null; matrixUserId?: string | null }): Record<string, string> {
    const query: Record<string, string> = {};
    if (params?.hsUrl) query.hs_url = params.hsUrl;
    if (params?.matrixUserId) query.matrix_user_id = params.matrixUserId;
    return query;
}

function buildHubAuthHeaders(params?: { matrixAccessToken?: string | null }): Record<string, string> | undefined {
    if (!params?.matrixAccessToken) return undefined;
    return { "X-Matrix-Access-Token": params.matrixAccessToken };
}

export async function listTasks(params: {
    accessToken: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<{ items: HubTaskItem[] }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query = buildHubAuthQuery(params);
    const url = Object.keys(query).length ? withQuery(joinUrl(hubBaseUrl, "/tasks"), query) : joinUrl(hubBaseUrl, "/tasks");
    return getJson<{ items: HubTaskItem[] }>(url, params.accessToken, buildHubAuthHeaders(params));
}

export async function createTask(params: {
    accessToken: string;
    body: HubTaskPayload;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<HubTaskItem> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query = buildHubAuthQuery(params);
    const url = Object.keys(query).length ? withQuery(joinUrl(hubBaseUrl, "/tasks"), query) : joinUrl(hubBaseUrl, "/tasks");
    return postJson<HubTaskItem>(url, params.body, params.accessToken, buildHubAuthHeaders(params));
}

export async function updateTask(params: {
    accessToken: string;
    id: string;
    body: HubTaskPayload;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<HubTaskItem> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query = buildHubAuthQuery(params);
    const base = joinUrl(hubBaseUrl, `/tasks/${encodeURIComponent(params.id)}`);
    const url = Object.keys(query).length ? withQuery(base, query) : base;
    const response = await fetch(url, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.accessToken}`,
            ...(buildHubAuthHeaders(params) || {}),
        },
        body: JSON.stringify(params.body),
    });
    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }
    return (await response.json()) as HubTaskItem;
}

export async function deleteTask(params: {
    accessToken: string;
    id: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    matrixAccessToken?: string | null;
}): Promise<{ ok: boolean; id: string }> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const query = buildHubAuthQuery(params);
    const base = joinUrl(hubBaseUrl, `/tasks/${encodeURIComponent(params.id)}`);
    const url = Object.keys(query).length ? withQuery(base, query) : base;
    const response = await fetch(url, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
            ...(buildHubAuthHeaders(params) || {}),
        },
    });
    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }
    return (await response.json()) as { ok: boolean; id: string };
}

async function getJson<T>(url: string, accessToken?: string, extraHeaders?: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(extraHeaders || {}),
        },
    });

    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }

    return (await response.json()) as T;
}
