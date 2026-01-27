import { hubApiBaseUrl } from "../config";
import type { HubClientLoginResponse, HubClientSignupPayload, HubMatrixCredentials } from "./types";

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
