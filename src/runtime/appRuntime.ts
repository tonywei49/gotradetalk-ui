export type AppRuntime = "web" | "tauri-desktop" | "tauri-mobile";
export type RuntimePlatform = "web" | "windows" | "macos" | "linux" | "ios" | "android" | "unknown";

export function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function resolveRuntimePlatform(): RuntimePlatform {
    if (typeof navigator === "undefined") return "unknown";

    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (ua.includes("android")) return "android";
    if (ua.includes("windows")) return "windows";
    if (ua.includes("mac os x") || ua.includes("macintosh")) return "macos";
    if (ua.includes("linux")) return "linux";
    return "web";
}

export function isMobilePlatform(platform = resolveRuntimePlatform()): boolean {
    return platform === "ios" || platform === "android";
}

export function getAppRuntime(): AppRuntime {
    if (!isTauriRuntime()) return "web";
    return isMobilePlatform() ? "tauri-mobile" : "tauri-desktop";
}

export function isTauriDesktop(): boolean {
    return getAppRuntime() === "tauri-desktop";
}

export function isTauriMobile(): boolean {
    return getAppRuntime() === "tauri-mobile";
}
