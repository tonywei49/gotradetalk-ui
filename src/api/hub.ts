import { hubApiBaseUrl } from "../config";
import type { HubClientLoginResponse, HubClientSignupPayload, HubMatrixCredentials } from "./types";

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
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

export type HubStaffPasswordStateResponse = {
    password_state: string;
};

export async function hubStaffPasswordState(
    accessToken: string,
    hsUrl: string,
): Promise<HubStaffPasswordStateResponse> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = new URL(`${hubBaseUrl}/staff/password-state/self`);
    url.searchParams.set("hs_url", hsUrl);
    return getJson<HubStaffPasswordStateResponse>(url.toString(), accessToken);
}

export async function hubStaffActivatePasswordState(accessToken: string, hsUrl: string): Promise<void> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    await postJson<Record<string, unknown>>(
        `${hubBaseUrl}/staff/password-state/activate-self`,
        { hs_url: hsUrl },
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
