import { useTranslation } from "react-i18next";
import type { TaskItem, TaskStatus } from "../types";
import { getTaskStatusBadgeClass } from "../statusStyles";

type TaskListProps = {
    tasks: TaskItem[];
    statuses: TaskStatus[];
    selectedTaskId: string | null;
    onSelectTask: (taskId: string) => void;
    onCreateTask: () => void;
};

export function TaskList({
    tasks,
    statuses,
    selectedTaskId,
    onSelectTask,
    onCreateTask,
}: TaskListProps) {
    const { t } = useTranslation();
    const statusMap = new Map(statuses.map((status) => [status.id, status]));

    return (
        <div className="flex h-full flex-col bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-slate-800">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {t("tasks.title")}
                </div>
                <button
                    type="button"
                    onClick={onCreateTask}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:text-slate-200"
                >
                    {t("tasks.newTask")}
                </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
                {tasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {t("tasks.empty")}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {tasks.map((task) => (
                            <button
                                key={task.id}
                                type="button"
                                onClick={() => onSelectTask(task.id)}
                                className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                                    selectedTaskId === task.id
                                        ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20"
                                        : "border-gray-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                                }`}
                            >
                                <div className="mb-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                                    {task.title || t("tasks.untitled")}
                                </div>
                                <div className="mb-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                                    {task.content || t("tasks.noDetails")}
                                </div>
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                    <span
                                        className={`inline-flex rounded-full border px-2 py-0.5 ${getTaskStatusBadgeClass(statusMap.get(task.statusId)?.color)}`}
                                    >
                                        {statusMap.get(task.statusId)?.name || t("tasks.unknownStatus")}
                                    </span>
                                    <span className="text-slate-400 dark:text-slate-500">
                                        {task.createdAt}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
