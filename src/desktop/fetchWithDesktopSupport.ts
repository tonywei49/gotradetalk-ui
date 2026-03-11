import { invoke } from "@tauri-apps/api/core";

let nativeFetchRef: typeof fetch | null = null;

export function isTauriDesktop(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function setNativeFetch(fetchImpl: typeof fetch): void {
    nativeFetchRef = fetchImpl;
}

function toRequestUrl(input: URL | Request | string): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
}

function isRemoteHttpUrl(input: URL | Request | string): boolean {
    if (typeof window === "undefined") {
        return /^https?:\/\//i.test(toRequestUrl(input));
    }

    const url = new URL(toRequestUrl(input), window.location.href);
    if (!/^https?:$/i.test(url.protocol)) return false;

    // Keep app-local requests on the WebView path so bundled assets and wasm
    // do not get redirected through the Rust HTTP bridge.
    if (url.origin === window.location.origin) return false;

    return true;
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

function decodeBase64(base64: string): Uint8Array {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    return buffer;
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
            bodyBase64: string;
        }>("desktop_http_request", { input: payload });

        return new Response(new Blob([toArrayBuffer(decodeBase64(response.bodyBase64))]), {
            status: response.status,
            headers: new Headers(response.headers),
        });
    }
    const fallbackFetch = nativeFetchRef ?? fetch;
    return fallbackFetch(input, init);
}
