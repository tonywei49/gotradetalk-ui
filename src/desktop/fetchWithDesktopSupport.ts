import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriHttpFetch } from "@tauri-apps/plugin-http";
import { isTauriMobile, isTauriRuntime } from "../runtime/appRuntime";

export { isTauriDesktop } from "../runtime/appRuntime";

let nativeFetchRef: typeof fetch | null = null;

function shouldBypassDesktopBridge(url: URL): boolean {
    const hostname = url.hostname.toLowerCase();

    // Supabase auth/session flows are more reliable when kept on the WebView
    // fetch path so cookie/session handling stays inside the browser runtime.
    if (hostname === "supabase.co" || hostname.endsWith(".supabase.co")) {
        return true;
    }

    if (url.pathname.startsWith("/auth/v1/")) {
        return true;
    }

    return false;
}

function shouldForceInvokeBridge(url: URL): boolean {
    if (!isTauriMobile()) return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === "notebook-api.gotradetalk.com" || hostname.startsWith("notebook-api.");
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

    if (shouldBypassDesktopBridge(url)) return false;

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
    if (isTauriRuntime() && isRemoteHttpUrl(input)) {
        const resolvedUrl = typeof window === "undefined"
            ? new URL(toRequestUrl(input))
            : new URL(toRequestUrl(input), window.location.href);
        try {
            if (shouldForceInvokeBridge(resolvedUrl)) {
                throw new Error("force-invoke-bridge");
            }
            return await tauriHttpFetch(input, init);
        } catch (pluginError) {
            console.warn("Plugin HTTP fetch failed, falling back to invoke bridge:", pluginError);
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
    }
    const fallbackFetch = nativeFetchRef ?? fetch;
    return fallbackFetch(input, init);
}
