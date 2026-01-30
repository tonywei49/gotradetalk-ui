import { hubApiBaseUrl } from "../config";

type ContactEntry = {
    contact_id: string;
    initiated_by_me: boolean;
    user_id: string;
    display_name: string | null;
    user_local_id: string | null;
    company_name: string | null;
    country: string | null;
    handle: string | null;
    matrix_user_id: string | null;
    user_type: string | null;
    gender: string | null;
    locale: string | null;
    translation_locale: string | null;
};

type ContactRequestEntry = {
    request_id: string;
    requester_id: string;
    display_name: string | null;
    user_local_id: string | null;
    company_name: string | null;
    country: string | null;
    handle: string | null;
    matrix_user_id: string | null;
    user_type: string | null;
    matrix_room_id: string | null;
    initial_message: string | null;
};

type OutgoingContactRequestEntry = {
    request_id: string;
    target_id: string;
    display_name: string | null;
    user_local_id: string | null;
    company_name: string | null;
    country: string | null;
    handle: string | null;
    matrix_user_id: string | null;
    user_type: string | null;
};

type ListResponse<T> = {
    items: T[];
};

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

function withHsUrl(url: string, hsUrl?: string | null): string {
    if (!hsUrl) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}hs_url=${encodeURIComponent(hsUrl)}`;
}

function withAccessToken(url: string, accessToken?: string | null, hsUrl?: string | null): string {
    if (!hsUrl || !accessToken) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}access_token=${encodeURIComponent(accessToken)}`;
}

function withMatrixUserId(url: string, matrixUserId?: string | null, hsUrl?: string | null): string {
    if (!hsUrl || !matrixUserId) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}matrix_user_id=${encodeURIComponent(matrixUserId)}`;
}

async function getJson<T>(url: string, accessToken: string, hsUrl?: string | null): Promise<T> {
    const matrixUserId = hsUrl ? localStorage.getItem("gt_matrix_user_id") : null;
    const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(hsUrl ? { "x-hs-url": hsUrl } : {}),
            ...(matrixUserId ? { "x-matrix-user-id": matrixUserId } : {}),
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed (${response.status})`);
    }

    return (await response.json()) as T;
}

async function postJson<T>(
    url: string,
    accessToken: string,
    body: Record<string, unknown>,
    hsUrl?: string | null,
): Promise<T> {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            ...(hsUrl ? { "x-hs-url": hsUrl } : {}),
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed (${response.status})`);
    }

    return (await response.json()) as T;
}

export async function listContacts(accessToken: string, hsUrl?: string | null): Promise<ContactEntry[]> {
    const base = normalizeBaseUrl(hubApiBaseUrl);
    const matrixUserId = hsUrl ? localStorage.getItem("gt_matrix_user_id") : null;
    const url = withMatrixUserId(
        withAccessToken(withHsUrl(`${base}/contacts`, hsUrl), accessToken, hsUrl),
        matrixUserId,
        hsUrl,
    );
    const response = await getJson<ListResponse<ContactEntry>>(url, accessToken, hsUrl);
    return response.items;
}

export async function listContactRequests(
    accessToken: string,
    hsUrl?: string | null,
): Promise<ContactRequestEntry[]> {
    const base = normalizeBaseUrl(hubApiBaseUrl);
    const matrixUserId = hsUrl ? localStorage.getItem("gt_matrix_user_id") : null;
    const url = withMatrixUserId(
        withAccessToken(withHsUrl(`${base}/contacts/requests`, hsUrl), accessToken, hsUrl),
        matrixUserId,
        hsUrl,
    );
    const response = await getJson<ListResponse<ContactRequestEntry>>(url, accessToken, hsUrl);
    return response.items;
}

export async function listOutgoingContactRequests(
    accessToken: string,
    hsUrl?: string | null,
): Promise<OutgoingContactRequestEntry[]> {
    const base = normalizeBaseUrl(hubApiBaseUrl);
    const matrixUserId = hsUrl ? localStorage.getItem("gt_matrix_user_id") : null;
    const url = withMatrixUserId(
        withAccessToken(withHsUrl(`${base}/contacts/requests/outgoing`, hsUrl), accessToken, hsUrl),
        matrixUserId,
        hsUrl,
    );
    const response = await getJson<ListResponse<OutgoingContactRequestEntry>>(url, accessToken, hsUrl);
    return response.items;
}

export async function requestContact(
    accessToken: string,
    targetId: string,
    initialMessage: string,
    matrixRoomId: string,
    hsUrl?: string | null,
): Promise<{ status: string }> {
    const base = normalizeBaseUrl(hubApiBaseUrl);
    const url = `${base}/contacts/request`;
    return postJson<{ status: string }>(
        url,
        accessToken,
        { target_id: targetId, initial_message: initialMessage, matrix_room_id: matrixRoomId },
        hsUrl,
    );
}

export async function acceptContact(
    accessToken: string,
    requesterId: string,
    hsUrl?: string | null,
): Promise<{ status: string; matrix_room_id: string | null }> {
    const base = normalizeBaseUrl(hubApiBaseUrl);
    const url = `${base}/contacts/accept`;
    return postJson<{ status: string; matrix_room_id: string | null }>(url, accessToken, { requester_id: requesterId }, hsUrl);
}

export async function rejectContact(
    accessToken: string,
    requesterId: string,
    hsUrl?: string | null,
): Promise<{ status: string }> {
    const base = normalizeBaseUrl(hubApiBaseUrl);
    const url = `${base}/contacts/reject`;
    return postJson<{ status: string }>(url, accessToken, { requester_id: requesterId }, hsUrl);
}

export async function removeContact(
    accessToken: string,
    targetId: string,
    hsUrl?: string | null,
): Promise<{ status: string }> {
    const base = normalizeBaseUrl(hubApiBaseUrl);
    const url = `${base}/contacts/remove`;
    return postJson<{ status: string }>(url, accessToken, { target_id: targetId }, hsUrl);
}
