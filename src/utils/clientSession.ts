const DEVICE_FINGERPRINT_KEY = "gtt_device_fingerprint_v1";

export type ClientLoginSessionMetadata = {
    session_slot: "computer" | "mobile";
    platform: "web" | "windows" | "macos" | "linux" | "ios" | "android" | "unknown";
    app_variant: "web" | "tauri";
    device_name: string;
    device_fingerprint: string;
};

function isTauriDesktopRuntime(): boolean {
    if (typeof window === "undefined") return false;
    return "__TAURI_INTERNALS__" in window;
}

function normalizePlatform(): ClientLoginSessionMetadata["platform"] {
    if (typeof navigator === "undefined") return "unknown";
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (ua.includes("android")) return "android";
    if (ua.includes("windows")) return "windows";
    if (ua.includes("mac os x") || ua.includes("macintosh")) return "macos";
    if (ua.includes("linux")) return "linux";
    return "web";
}

function defaultDeviceName(platform: ClientLoginSessionMetadata["platform"], appVariant: ClientLoginSessionMetadata["app_variant"]): string {
    if (appVariant === "tauri") {
        if (platform === "windows") return "GoTradeTalk Desktop (Windows)";
        if (platform === "macos") return "GoTradeTalk Desktop (macOS)";
        if (platform === "linux") return "GoTradeTalk Desktop (Linux)";
        return "GoTradeTalk Desktop";
    }
    return "GoTradeTalk Web";
}

function readOrCreateFingerprint(): string {
    if (typeof window === "undefined") return "server-render";
    try {
        const existing = window.localStorage.getItem(DEVICE_FINGERPRINT_KEY);
        if (existing) return existing;
        const next = crypto.randomUUID();
        window.localStorage.setItem(DEVICE_FINGERPRINT_KEY, next);
        return next;
    } catch {
        return crypto.randomUUID();
    }
}

export function getClientLoginSessionMetadata(): ClientLoginSessionMetadata {
    const appVariant: ClientLoginSessionMetadata["app_variant"] = isTauriDesktopRuntime() ? "tauri" : "web";
    const platform = normalizePlatform();
    return {
        session_slot: "computer",
        platform,
        app_variant: appVariant,
        device_name: defaultDeviceName(platform, appVariant),
        device_fingerprint: readOrCreateFingerprint(),
    };
}
