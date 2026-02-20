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

async function postJson<T>(url: string, body: Record<string, unknown>, accessToken?: string): Promise<T> {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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
    matrixUserId?: string | null;
}): Promise<HubSupabaseSession> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);

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
        } catch {
            // try next candidate path
        }
    }

    throw new Error("NO_VALID_HUB_TOKEN");
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

async function getJson<T>(url: string, accessToken?: string): Promise<T> {
    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
    });

    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }

    return (await response.json()) as T;
}
