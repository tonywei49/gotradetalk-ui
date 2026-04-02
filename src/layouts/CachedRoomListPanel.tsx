import { useEffect } from "react";
import { useTranslation } from "react-i18next";

type CachedRoomListPanelProps = {
    onUnreadBadgeChange?: (count: number) => void;
    view?: "chat" | "contacts";
    onRequestLiveSync?: () => void;
    liveSyncStarting?: boolean;
};

export function CachedRoomListPanel({
    onUnreadBadgeChange,
    view = "chat",
    onRequestLiveSync,
    liveSyncStarting = false,
}: CachedRoomListPanelProps) {
    const { t } = useTranslation();

    useEffect(() => {
        onUnreadBadgeChange?.(0);
    }, [onUnreadBadgeChange]);

    return (
        <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar">
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {view === "contacts" ? t("roomList.sections.contacts") : t("roomList.sections.chatRooms")}
                </span>
                <button
                    type="button"
                    onClick={() => onRequestLiveSync?.()}
                    disabled={liveSyncStarting}
                    className="inline-flex items-center rounded-full border border-emerald-300 px-3 py-1 text-[11px] font-semibold text-emerald-700 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-700 dark:text-emerald-300"
                >
                    {liveSyncStarting ? "Connecting..." : "Connect live"}
                </button>
            </div>
            <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                <div>
                    {view === "contacts"
                        ? "Windows startup keeps the contacts sidebar unloaded until live sync is requested."
                        : "Windows startup keeps the room list unloaded until live sync is requested."}
                </div>
                <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    This build is intentionally using a thin shell to isolate the startup memory spike.
                </div>
            </div>
        </div>
    );
}
