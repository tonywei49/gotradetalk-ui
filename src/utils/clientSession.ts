import { getAppRuntime, isMobilePlatform, resolveRuntimePlatform } from "../runtime/appRuntime";

const DEVICE_FINGERPRINT_KEY = "gtt_device_fingerprint_v1";

export type ClientLoginSessionMetadata = {
    session_slot: "computer" | "mobile";
    platform: "web" | "windows" | "macos" | "linux" | "ios" | "android" | "unknown";
    app_variant: "web" | "tauri";
    device_name: string;
    device_fingerprint: string;
};

function defaultDeviceName(
    platform: ClientLoginSessionMetadata["platform"],
    appVariant: ClientLoginSessionMetadata["app_variant"],
    sessionSlot: ClientLoginSessionMetadata["session_slot"],
): string {
    if (appVariant === "tauri") {
        if (sessionSlot === "mobile") {
            if (platform === "ios") return "GoTradeTalk Mobile (iOS)";
            if (platform === "android") return "GoTradeTalk Mobile (Android)";
            return "GoTradeTalk Mobile";
        }
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
    const runtime = getAppRuntime();
    const appVariant: ClientLoginSessionMetadata["app_variant"] = runtime === "web" ? "web" : "tauri";
    const platform = resolveRuntimePlatform();
    const sessionSlot: ClientLoginSessionMetadata["session_slot"] = isMobilePlatform(platform) ? "mobile" : "computer";
    return {
        session_slot: sessionSlot,
        platform,
        app_variant: appVariant,
        device_name: defaultDeviceName(platform, appVariant, sessionSlot),
        device_fingerprint: readOrCreateFingerprint(),
    };
}
