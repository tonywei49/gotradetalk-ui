import { useTranslation } from "react-i18next";
import type { TaskItem } from "../types";

type TaskReminderBannerProps = {
    task: TaskItem | null;
    onSnooze: () => void;
    onDismiss: () => void;
};

export function TaskReminderBanner({ task, onSnooze, onDismiss }: TaskReminderBannerProps) {
    const { t } = useTranslation();
    if (!task) return null;

    return (
        <div className="animate-pulse border-b-2 border-rose-500 bg-rose-50 px-4 py-3 text-sm shadow-[inset_0_0_0_1px_rgba(244,63,94,0.25)] dark:border-rose-500 dark:bg-rose-950/40 dark:shadow-[inset_0_0_0_1px_rgba(251,113,133,0.35)]">
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="font-semibold text-rose-700 dark:text-rose-200">
                        {t("tasks.reminderTitle")}
                    </div>
                    <div className="truncate text-rose-600 dark:text-rose-100">
                        {task.title || t("tasks.untitled")}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onSnooze}
                        className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-100"
                    >
                        {t("tasks.remindInFiveMinutes")}
                    </button>
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="rounded-lg border border-rose-400 bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white dark:border-rose-500 dark:bg-rose-500 dark:text-white"
                    >
                        {t("tasks.dismissReminder")}
                    </button>
                </div>
            </div>
        </div>
    );
}
