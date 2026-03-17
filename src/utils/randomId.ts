function fallbackRandomId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function safeRandomId(): string {
    const cryptoObject = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
        try {
            return cryptoObject.randomUUID();
        } catch {
            // Fall through to non-crypto fallback on broken WebView implementations.
        }
    }
    return fallbackRandomId();
}
