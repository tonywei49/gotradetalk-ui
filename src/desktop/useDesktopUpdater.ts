import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToastStore, type ToastType } from "../stores/ToastStore";

type DesktopUpdaterStatus = {
    enabled: boolean;
    currentVersion: string;
    reason?: string | null;
};

type DesktopUpdateCheck = {
    available: boolean;
    currentVersion: string;
    version?: string | null;
    notes?: string | null;
};

type DesktopInstallResult = {
    installed: boolean;
    version?: string | null;
    restartScheduled: boolean;
};

const UPDATER_SESSION_KEY = "gtt_desktop_updater_checked_v1";

type PushToast = (type: ToastType, message: string, durationMs?: number) => void;

type DesktopUpdateCheckOptions = {
    notifyWhenCurrent: boolean;
};

export function isTauriDesktop(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatUpdatePrompt(check: DesktopUpdateCheck): string {
    const summary = `A new desktop version ${check.version} is available.\nCurrent version: ${check.currentVersion}.`;
    const notes = check.notes?.trim();
    if (!notes) {
        return `${summary}\n\nDownload and install it now?`;
    }

    const compactNotes = notes.length > 280 ? `${notes.slice(0, 280)}...` : notes;
    return `${summary}\n\nRelease notes:\n${compactNotes}\n\nDownload and install it now?`;
}

async function runDesktopUpdateCheck(
    pushToast: PushToast,
    options: DesktopUpdateCheckOptions,
): Promise<"disabled" | "idle" | "installed"> {
    const status = await invoke<DesktopUpdaterStatus>("desktop_updater_status");
    if (!status.enabled) {
        if (status.reason) {
            console.info("Desktop updater disabled:", status.reason);
        }
        return "disabled";
    }

    const check = await invoke<DesktopUpdateCheck>("desktop_check_for_updates");
    if (!check.available || !check.version) {
        if (options.notifyWhenCurrent) {
            pushToast("success", "Desktop app is already up to date.", 3000);
        }
        return "idle";
    }

    pushToast("warn", `Update ${check.version} is available.`, 5000);
    const confirmed = window.confirm(formatUpdatePrompt(check));
    if (!confirmed) return "idle";

    pushToast("warn", `Downloading update ${check.version}...`, 5000);
    const result = await invoke<DesktopInstallResult>("desktop_install_update");
    if (!result.installed) return "idle";

    pushToast("success", `Update ${result.version ?? check.version} installed. Restarting...`, 4000);
    return "installed";
}

export async function checkDesktopUpdaterOnce(pushToast: PushToast): Promise<"disabled" | "idle" | "installed"> {
    if (!isTauriDesktop()) return "disabled";
    return runDesktopUpdateCheck(pushToast, { notifyWhenCurrent: true });
}

export function useDesktopUpdater() {
    const pushToast = useToastStore((state) => state.pushToast);

    useEffect(() => {
        if (import.meta.env.DEV || !isTauriDesktop()) return;
        if (window.sessionStorage.getItem(UPDATER_SESSION_KEY) === "1") return;
        window.sessionStorage.setItem(UPDATER_SESSION_KEY, "1");

        let cancelled = false;

        void (async () => {
            try {
                await runDesktopUpdateCheck(pushToast, { notifyWhenCurrent: false });
                if (cancelled) return;
            } catch (error) {
                console.warn("Desktop updater check failed:", error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [pushToast]);
}
