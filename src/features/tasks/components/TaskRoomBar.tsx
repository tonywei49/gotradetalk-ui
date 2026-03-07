import { useTranslation } from "react-i18next";
import type { TaskItem, TaskStatus } from "../types";
import { getTaskStatusBadgeClass } from "../statusStyles";

type TaskRoomBarProps = {
    tasks: TaskItem[];
    statuses: TaskStatus[];
    expandedTaskIds: string[];
    onToggle: (taskId: string) => void;
    onStatusChange?: (taskId: string, statusId: string) => void;
};

export function TaskRoomBar({
    tasks,
    statuses,
    expandedTaskIds,
    onToggle,
    onStatusChange,
}: TaskRoomBarProps) {
    const { t } = useTranslation();
    const statusMap = new Map(statuses.map((status) => [status.id, status]));

    if (tasks.length === 0) return null;

    return (
        <div className="space-y-2">
            {tasks.map((task) => {
                const expanded = expandedTaskIds.includes(task.id);
                return (
                    <button
                        key={task.id}
                        type="button"
                        onClick={() => onToggle(task.id)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left dark:border-slate-700 dark:bg-slate-900"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {task.title || t("tasks.untitled")}
                            </div>
                            <div className="flex items-center gap-2 text-[11px]">
                                <span
                                    className={`inline-flex rounded-full border px-2 py-0.5 ${getTaskStatusBadgeClass(statusMap.get(task.statusId)?.color)}`}
                                >
                                    {statusMap.get(task.statusId)?.name || t("tasks.unknownStatus")}
                                </span>
                                <span className="text-slate-400 dark:text-slate-500">
                                    {task.createdAt}
                                </span>
                            </div>
                        </div>
                        {expanded ? (
                            <div className="mt-2 space-y-2">
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                    {task.content || t("tasks.noDetails")}
                                </div>
                                {onStatusChange ? (
                                    <div className="flex flex-wrap gap-2">
                                        {statuses.map((status) => (
                                            <button
                                                key={status.id}
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onStatusChange(task.id, status.id);
                                                }}
                                                className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
                                                    task.statusId === status.id
                                                        ? getTaskStatusBadgeClass(status.color)
                                                        : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
                                                }`}
                                            >
                                                {status.name}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
