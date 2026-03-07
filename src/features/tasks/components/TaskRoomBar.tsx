import { useTranslation } from "react-i18next";
import type { TaskItem, TaskStatus } from "../types";
import { getTaskStatusBadgeClass } from "../statusStyles";

type TaskRoomBarProps = {
    tasks: TaskItem[];
    statuses: TaskStatus[];
    expandedTaskIds: string[];
    onToggle: (taskId: string) => void;
};

export function TaskRoomBar({
    tasks,
    statuses,
    expandedTaskIds,
    onToggle,
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
                            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                {task.content || t("tasks.noDetails")}
                            </div>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}
