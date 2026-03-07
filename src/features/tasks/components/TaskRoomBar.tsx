import { ChevronRightIcon } from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
import type { TaskItem, TaskStatus } from "../types";
import { getTaskStatusBadgeClass } from "../statusStyles";

type TaskRoomBarProps = {
    tasks: TaskItem[];
    statuses: TaskStatus[];
    expandedTaskIds: string[];
    onToggle: (taskId: string) => void;
    onStatusChange?: (taskId: string, statusId: string) => void;
    onOpenTaskList?: () => void;
};

export function TaskRoomBar({
    tasks,
    statuses,
    expandedTaskIds,
    onToggle,
    onStatusChange,
    onOpenTaskList,
}: TaskRoomBarProps) {
    const { t } = useTranslation();
    const statusMap = new Map(statuses.map((status) => [status.id, status]));

    if (tasks.length === 0) return null;

    return (
        <div className="space-y-2">
            {tasks.map((task) => {
                const expanded = expandedTaskIds.includes(task.id);
                return (
                    <div
                        key={task.id}
                        className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    >
                        <button
                            type="button"
                            onClick={() => onToggle(task.id)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                        >
                            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
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
                                <ChevronRightIcon
                                    className={`h-4 w-4 text-slate-400 transition-transform dark:text-slate-500 ${expanded ? "rotate-90" : ""}`}
                                />
                            </div>
                        </button>
                        {expanded ? (
                            <div className="space-y-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                                <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
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
                                {onOpenTaskList ? (
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={onOpenTaskList}
                                            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                                        >
                                            {t("tasks.jumpToTaskList")}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
