import { hubApiBaseUrl } from "../../config";

export type ChatSearchScope = "all" | "people" | "rooms" | "messages";
export type ChatRoomSearchType = "all" | "messages" | "files";

export type ChatSearchPersonHit = {
    profile_id: string;
    display_name: string | null;
    user_local_id: string | null;
    handle: string | null;
    matrix_user_id: string | null;
    user_type: string | null;
    company_name: string | null;
};

export type ChatSearchRoomHit = {
    room_id: string;
    room_name: string | null;
    last_ts: string | null;
};

export type ChatSearchMessageHit = {
    room_id: string;
    event_id: string;
    preview: string;
    ts: string | null;
    sender: string | null;
    score?: number;
};

export type ChatSearchFileHit = {
    room_id: string;
    event_id: string;
    file_name: string | null;
    mime: string | null;
    size: number | null;
    ts: string | null;
    sender: string | null;
    mxc?: string | null;
};

export type ChatSearchGlobalResponse = {
    people_hits: ChatSearchPersonHit[];
    room_hits: ChatSearchRoomHit[];
    message_hits: ChatSearchMessageHit[];
    next_cursor: string | null;
};

export type ChatSearchRoomResponse = {
    room_id: string;
    message_hits: ChatSearchMessageHit[];
    file_hits: ChatSearchFileHit[];
    next_cursor: string | null;
};

export type ChatSearchLocateResponse = {
    room_id: string;
    event_id: string;
    anchor_event?: {
        event_id: string;
        ts: string | null;
        sender: string | null;
        body: string;
        msgtype: string | null;
    } | null;
    events_before?: Array<{
        event_id: string;
        ts: string | null;
        sender: string | null;
        body: string;
        msgtype: string | null;
    }>;
    events_after?: Array<{
        event_id: string;
        ts: string | null;
        sender: string | null;
        body: string;
        msgtype: string | null;
    }>;
    pagination?: {
        older_cursor: string | null;
        newer_cursor: string | null;
    };
};

export class ChatSearchError extends Error {
    public readonly status: number;
    public readonly code: string;

    constructor(message: string, status: number, code: string) {
        super(message);
        this.name = "ChatSearchError";
        this.status = status;
        this.code = code;
    }
}

type ChatSearchAuth = {
    accessToken: string;
    matrixAccessToken: string;
    hsUrl: string;
    matrixUserId: string;
};

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

function isLikelyJwtToken(token: string): boolean {
    const trimmed = token.trim();
    if (!trimmed.startsWith("eyJ")) return false;
    const parts = trimmed.split(".");
    return parts.length === 3 && parts.every((part) => part.length > 0);
}

function ensureAuth(auth: ChatSearchAuth): void {
    if (!auth.accessToken || !isLikelyJwtToken(auth.accessToken)) {
        throw new ChatSearchError("NO_VALID_HUB_TOKEN", 401, "NO_VALID_HUB_TOKEN");
    }
    if (!auth.matrixAccessToken) {
        throw new ChatSearchError("MISSING_MATRIX_TOKEN", 401, "MISSING_MATRIX_TOKEN");
    }
}

async function readError(response: Response): Promise<ChatSearchError> {
    let message = response.statusText || "Request failed";
    let code = "UNKNOWN";
    try {
        const data = (await response.json()) as { message?: string; code?: string };
        if (data.message) message = data.message;
        if (data.code) code = data.code;
    } catch {
        // ignore
    }
    if (!code) {
        if (response.status === 401) code = "INVALID_AUTH_TOKEN";
        if (response.status === 403) code = "SEARCH_FORBIDDEN";
    }
    return new ChatSearchError(message, response.status, code || "UNKNOWN");
}

async function getJson<T>(
    path: string,
    auth: ChatSearchAuth,
    query: Record<string, string | undefined>,
): Promise<T> {
    ensureAuth(auth);
    const base = normalizeBaseUrl(hubApiBaseUrl);
    const url = new URL(`${base}${path}`);
    url.searchParams.set("hs_url", auth.hsUrl);
    url.searchParams.set("matrix_user_id", auth.matrixUserId);
    Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, value);
        }
    });
    const response = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            "X-Matrix-Access-Token": auth.matrixAccessToken,
            "X-HS-URL": auth.hsUrl,
        },
    });
    if (!response.ok) {
        throw await readError(response);
    }
    return (await response.json()) as T;
}

export async function chatSearchGlobal(
    auth: ChatSearchAuth,
    input: {
        q: string;
        scope?: ChatSearchScope;
        fromTs?: string;
        toTs?: string;
        limit?: number;
        cursor?: string;
    },
): Promise<ChatSearchGlobalResponse> {
    return getJson<ChatSearchGlobalResponse>("/chat/search/global", auth, {
        q: input.q,
        scope: input.scope || "all",
        from_ts: input.fromTs,
        to_ts: input.toTs,
        limit: input.limit ? String(input.limit) : undefined,
        cursor: input.cursor,
    });
}

export async function chatSearchRoom(
    auth: ChatSearchAuth,
    input: {
        roomId: string;
        q?: string;
        type?: ChatRoomSearchType;
        fromTs?: string;
        toTs?: string;
        limit?: number;
        cursor?: string;
    },
): Promise<ChatSearchRoomResponse> {
    return getJson<ChatSearchRoomResponse>("/chat/search/room", auth, {
        room_id: input.roomId,
        q: input.q,
        type: input.type || "all",
        from_ts: input.fromTs,
        to_ts: input.toTs,
        limit: input.limit ? String(input.limit) : undefined,
        cursor: input.cursor,
    });
}

export async function chatSearchLocate(
    auth: ChatSearchAuth,
    input: {
        roomId: string;
        eventId: string;
        contextBefore?: number;
        contextAfter?: number;
    },
): Promise<ChatSearchLocateResponse> {
    return getJson<ChatSearchLocateResponse>("/chat/search/locate", auth, {
        room_id: input.roomId,
        event_id: input.eventId,
        context_before: String(input.contextBefore ?? 5),
        context_after: String(input.contextAfter ?? 5),
    });
}
