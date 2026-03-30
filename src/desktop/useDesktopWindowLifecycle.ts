import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauriDesktop(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isWindowsDesktop(): boolean {
    if (!isTauriDesktop() || typeof navigator === "undefined") return false;
    return navigator.userAgent.toLowerCase().includes("windows");
}

export function useDesktopWindowLifecycle(bootReady = false) {
    const bootNotifiedRef = useRef(false);

    useEffect(() => {
        if (!isTauriDesktop()) return;

        let unlistenCloseRequested: (() => void) | undefined;
        const preventContextMenu = (event: MouseEvent) => {
            event.preventDefault();
        };

        if (!isWindowsDesktop()) {
            window.addEventListener("contextmenu", preventContextMenu, true);
        }

        void (async () => {
            try {
                const appWindow = getCurrentWindow();
                unlistenCloseRequested = await appWindow.onCloseRequested((event) => {
                    event.preventDefault();
                    void appWindow.hide();
                });
            } catch (error) {
                console.warn("Desktop close handler registration failed:", error);
            }
        })();

        return () => {
            unlistenCloseRequested?.();
            if (!isWindowsDesktop()) {
                window.removeEventListener("contextmenu", preventContextMenu, true);
            }
        };
    }, []);

    useEffect(() => {
        if (!isTauriDesktop() || !bootReady || bootNotifiedRef.current) return;
        bootNotifiedRef.current = true;
        void invoke("desktop_boot_ready").catch((error) => {
            console.warn("Desktop boot ready notification failed:", error);
            bootNotifiedRef.current = false;
        });
    }, [bootReady]);
}
