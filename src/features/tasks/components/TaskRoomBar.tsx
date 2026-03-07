import { ChevronRightIcon } from "@heroicons/react/24/solid";
import { useTranslation } from "react-i18next";
import type { TaskItem, TaskStatus } from "../types";

function getCompactStatusClass(statusId: string): string {
    if (statusId === "completed") {
        return "bg-emerald-500 text-white dark:bg-emerald-500 dark:text-white";
    }
    if (statusId === "in_progress") {
        return "bg-sky-500 text-white dark:bg-sky-500 dark:text-white";
    }
    return "bg-amber-500 text-white dark:bg-amber-500 dark:text-white";
}

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
                        className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    >
                        <button
                            type="button"
                            onClick={() => onToggle(task.id)}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                        >
                            <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                                {task.title || t("tasks.untitled")}
                            </div>
                            <div className="flex items-center gap-2 text-[11px]">
                                <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${getCompactStatusClass(task.statusId)}`}
                                >
                                    {statusMap.get(task.statusId)?.name || t("tasks.unknownStatus")}
                                </span>
                                <span className="text-slate-400 dark:text-slate-500">
                                    {task.createdAt}
                                </span>
                                <ChevronRightIcon
                                    className={`h-3.5 w-3.5 text-slate-400 transition-transform dark:text-slate-500 ${expanded ? "rotate-90" : ""}`}
                                />
                            </div>
                        </button>
                        {expanded ? (
                            <div className="space-y-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-800">
                                <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    {task.content || t("tasks.noDetails")}
                                </div>
                                {(onStatusChange || onOpenTaskList) ? (
                                    <div className="flex items-end justify-between gap-3">
                                        <div className="flex flex-wrap gap-2">
                                            {onStatusChange ? statuses.map((status) => (
                                                <button
                                                    key={status.id}
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        onStatusChange(task.id, status.id);
                                                    }}
                                                    className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                                                        task.statusId === status.id
                                                            ? getCompactStatusClass(status.id)
                                                            : "border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
                                                    }`}
                                                >
                                                    {status.name}
                                                </button>
                                            )) : null}
                                        </div>
                                        {onOpenTaskList ? (
                                            <button
                                                type="button"
                                                onClick={onOpenTaskList}
                                                className="shrink-0 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                                            >
                                                {t("tasks.jumpToTaskList")}
                                            </button>
                                        ) : null}
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
