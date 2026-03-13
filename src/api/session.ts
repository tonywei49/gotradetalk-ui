export const HUB_SESSION_REVOKED_EVENT = "gtt:hub-session-revoked";

export class HubApiError extends Error {
    public readonly status: number;
    public readonly code: string;

    constructor(message: string, status: number, code: string) {
        super(message);
        this.name = "HubApiError";
        this.status = status;
        this.code = code;
    }
}

export function dispatchHubSessionRevoked(message: string): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
        new CustomEvent(HUB_SESSION_REVOKED_EVENT, {
            detail: { message },
        }),
    );
}

export async function readHubError(response: Response): Promise<HubApiError> {
    let message = response.statusText || "Request failed";
    let code = "UNKNOWN";

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        try {
            const data = (await response.json()) as { message?: string; error?: string; code?: string };
            if (data.message) message = data.message;
            else if (data.error) message = data.error;
            if (data.code) code = data.code;
        } catch {
            // ignore JSON parse failure
        }
    } else {
        const text = await response.text();
        if (text) message = text;
    }

    if (!code && response.status === 401) code = "INVALID_AUTH_TOKEN";
    const error = new HubApiError(message || `Request failed (${response.status})`, response.status, code || "UNKNOWN");
    if (error.code === "SESSION_REVOKED") {
        dispatchHubSessionRevoked(error.message);
    }
    return error;
}
