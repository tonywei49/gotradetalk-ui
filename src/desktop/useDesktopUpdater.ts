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
    installWhenAvailable: boolean;
};

export function isTauriDesktop(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getDesktopUpdaterStatus(): Promise<DesktopUpdaterStatus> {
    return invoke<DesktopUpdaterStatus>("desktop_updater_status");
}

async function runDesktopUpdateCheck(
    pushToast: PushToast,
    options: DesktopUpdateCheckOptions,
): Promise<"disabled" | "idle" | "installed"> {
    const status = await getDesktopUpdaterStatus();
    if (!status.enabled) {
        if (status.reason) {
            console.info("Desktop updater disabled:", status.reason);
            if (options.notifyWhenCurrent) {
                pushToast("warn", `Desktop updater is unavailable for this build: ${status.reason}`, 4500);
            }
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
    if (!options.installWhenAvailable) return "idle";

    pushToast("warn", `Downloading update ${check.version}...`, 5000);
    const result = await invoke<DesktopInstallResult>("desktop_install_update");
    if (!result.installed) return "idle";

    pushToast("success", `Update ${result.version ?? check.version} installed. Restarting...`, 4000);
    return "installed";
}

export async function checkDesktopUpdaterOnce(pushToast: PushToast): Promise<"disabled" | "idle" | "installed"> {
    if (!isTauriDesktop()) return "disabled";
    return runDesktopUpdateCheck(pushToast, {
        notifyWhenCurrent: true,
        installWhenAvailable: true,
    });
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
                await runDesktopUpdateCheck(pushToast, {
                    notifyWhenCurrent: false,
                    installWhenAvailable: false,
                });
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
