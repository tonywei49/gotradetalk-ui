import { invoke } from "@tauri-apps/api/core";

export function isTauriDesktop(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function toRequestUrl(input: URL | Request | string): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
}

function isRemoteHttpUrl(input: URL | Request | string): boolean {
    return /^https?:\/\//i.test(toRequestUrl(input));
}

function mergeHeaders(input: URL | Request | string, init?: RequestInit): Headers {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
        new Headers(init.headers).forEach((value, key) => {
            headers.set(key, value);
        });
    }
    return headers;
}

async function readBody(input: URL | Request | string, init?: RequestInit): Promise<string | undefined> {
    if (typeof init?.body === "string") return init.body;
    if (input instanceof Request) {
        const cloned = input.clone();
        return cloned.text();
    }
    if (init?.body == null) return undefined;
    throw new Error("Desktop HTTP bridge only supports string request bodies");
}

export async function fetchWithDesktopSupport(input: URL | Request | string, init?: RequestInit): Promise<Response> {
    if (isTauriDesktop() && isRemoteHttpUrl(input)) {
        const payload = {
            url: toRequestUrl(input),
            method: init?.method ?? (input instanceof Request ? input.method : "GET"),
            headers: Array.from(mergeHeaders(input, init).entries()),
            body: await readBody(input, init),
        };
        const response = await invoke<{
            status: number;
            headers: Array<[string, string]>;
            body: string;
        }>("desktop_http_request", { input: payload });

        return new Response(response.body, {
            status: response.status,
            headers: new Headers(response.headers),
        });
    }
    return fetch(input, init);
}
