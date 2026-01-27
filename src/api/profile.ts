import { hubApiBaseUrl } from "../config";

type ProfileResponse = {
    preferred_language?: string | null;
};

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

async function getJson<T>(url: string, accessToken: string): Promise<T> {
    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }

    return (await response.json()) as T;
}

async function postJson<T>(url: string, body: Record<string, unknown>, accessToken: string): Promise<T> {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(await readResponseMessage(response));
    }

    return (await response.json()) as T;
}

export async function fetchClientLanguage(accessToken: string): Promise<string | null> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const response = await getJson<ProfileResponse>(`${hubBaseUrl}/client/profile`, accessToken);
    return response.preferred_language ?? null;
}

export async function fetchStaffLanguage(accessToken: string, hsUrl: string): Promise<string | null> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    const url = new URL(`${hubBaseUrl}/staff/profile`);
    url.searchParams.set("hs_url", hsUrl);
    const response = await getJson<ProfileResponse>(url.toString(), accessToken);
    return response.preferred_language ?? null;
}

export async function updateClientLanguage(accessToken: string, language: string): Promise<void> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    await postJson<Record<string, unknown>>(
        `${hubBaseUrl}/client/profile/language`,
        { preferred_language: language },
        accessToken,
    );
}

export async function updateStaffLanguage(accessToken: string, hsUrl: string, language: string): Promise<void> {
    const hubBaseUrl = normalizeBaseUrl(hubApiBaseUrl);
    await postJson<Record<string, unknown>>(
        `${hubBaseUrl}/staff/profile/language`,
        { preferred_language: language, hs_url: hsUrl },
        accessToken,
    );
}
