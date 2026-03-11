import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauriDesktop(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useDesktopWindowLifecycle() {
    useEffect(() => {
        if (!isTauriDesktop()) return;

        let disposed = false;
        let unlistenCloseRequested: (() => void) | undefined;
        const preventContextMenu = (event: MouseEvent) => {
            event.preventDefault();
        };

        window.addEventListener("contextmenu", preventContextMenu, true);

        void (async () => {
            try {
                await invoke("desktop_boot_ready");
            } catch (error) {
                console.warn("Desktop boot ready notification failed:", error);
            }

            if (disposed) return;

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
            disposed = true;
            unlistenCloseRequested?.();
            window.removeEventListener("contextmenu", preventContextMenu, true);
        };
    }, []);
}
