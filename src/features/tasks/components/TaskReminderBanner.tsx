import type { TaskItem } from "../types";

type TaskReminderBannerProps = {
    task: TaskItem | null;
    onSnooze: () => void;
    onDismiss: () => void;
};

export function TaskReminderBanner({ task, onSnooze, onDismiss }: TaskReminderBannerProps) {
    if (!task) return null;

    return (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/20">
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">
                        Task Reminder
                    </div>
                    <div className="truncate text-slate-600 dark:text-slate-300">
                        {task.title || "Untitled task"}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onSnooze}
                        className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:border-amber-700 dark:text-amber-300"
                    >
                        Remind in 5 min
                    </button>
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    );
}
