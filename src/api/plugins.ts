import { hubApiBaseUrl } from "../config";

export type PlatformMyPluginItem = {
    plugin_id: string;
    code: string;
    name: string;
    type: "internal" | "external";
    enabled: boolean;
    expires_at?: string | null;
    quota?: number | null;
    quota_used?: number | null;
    plan_type?: string | null;
    config?: Record<string, unknown> | null;
};

export type PlatformPluginConfigResponse = {
    plugin_id: string;
    config: Record<string, unknown> | null;
};

export type PlatformPluginTokenResponse = {
    plugin_id: string;
    token: string;
    expires_at?: string | null;
    scope?: string[] | null;
};

export type PlatformPluginUsageResponse = {
    message: string;
    quota_used?: number | null;
};

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

function joinUrl(base: string, path: string): string {
    const normalizedBase = normalizeBaseUrl(base);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
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
            // ignore parse failure
        }
    }
    return (await response.text()) || `Request failed (${response.status})`;
}

export async function getPlatformMyPlugins(params: {
    accessToken: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
}): Promise<{ items: PlatformMyPluginItem[] }> {
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;

    const baseUrl = joinUrl(normalizeBaseUrl(hubApiBaseUrl), "/platform/plugins/my-plugins");
    const url = Object.keys(query).length ? withQuery(baseUrl, query) : baseUrl;

    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }

    return (await response.json()) as { items: PlatformMyPluginItem[] };
}

export async function getPlatformPluginConfig(params: {
    accessToken: string;
    pluginId: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
}): Promise<PlatformPluginConfigResponse> {
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;

    const baseUrl = joinUrl(
        normalizeBaseUrl(hubApiBaseUrl),
        `/platform/plugins/${encodeURIComponent(params.pluginId)}/config`,
    );
    const url = Object.keys(query).length ? withQuery(baseUrl, query) : baseUrl;

    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }

    return (await response.json()) as PlatformPluginConfigResponse;
}

export async function issuePlatformPluginToken(params: {
    accessToken: string;
    pluginId: string;
    scope?: string[];
    hsUrl?: string | null;
    matrixUserId?: string | null;
}): Promise<PlatformPluginTokenResponse> {
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;

    const baseUrl = joinUrl(
        normalizeBaseUrl(hubApiBaseUrl),
        `/platform/plugins/${encodeURIComponent(params.pluginId)}/token`,
    );
    const url = Object.keys(query).length ? withQuery(baseUrl, query) : baseUrl;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.accessToken}`,
        },
        body: JSON.stringify({
            scope: params.scope ?? [],
        }),
    });

    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }

    return (await response.json()) as PlatformPluginTokenResponse;
}

export async function reportPlatformPluginUsage(params: {
    accessToken: string;
    pluginId: string;
    action: string;
    status: "success" | "failed";
    requestId: string;
    meta?: Record<string, unknown>;
    hsUrl?: string | null;
    matrixUserId?: string | null;
}): Promise<PlatformPluginUsageResponse> {
    const query: Record<string, string> = {};
    if (params.hsUrl) query.hs_url = params.hsUrl;
    if (params.matrixUserId) query.matrix_user_id = params.matrixUserId;

    const baseUrl = joinUrl(
        normalizeBaseUrl(hubApiBaseUrl),
        `/platform/plugins/${encodeURIComponent(params.pluginId)}/usage`,
    );
    const url = Object.keys(query).length ? withQuery(baseUrl, query) : baseUrl;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.accessToken}`,
        },
        body: JSON.stringify({
            action: params.action,
            status: params.status,
            request_id: params.requestId,
            meta: params.meta ?? {},
        }),
    });

    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }

    return (await response.json()) as PlatformPluginUsageResponse;
}
