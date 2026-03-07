import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import type { TaskItem, TaskStatus } from "../types";
import { getTaskStatusBadgeClass } from "../statusStyles";

type TaskListFilter = "all" | "active" | "completed" | "reminder" | "linked";

type TaskListProps = {
    tasks: TaskItem[];
    statuses: TaskStatus[];
    selectedTaskId: string | null;
    onSelectTask: (taskId: string) => void;
    onCreateTask: () => void;
    onOpenRoom?: (roomId: string) => void;
};

export function TaskList({
    tasks,
    statuses,
    selectedTaskId,
    onSelectTask,
    onCreateTask,
    onOpenRoom,
}: TaskListProps) {
    const { t } = useTranslation();
    const [filter, setFilter] = useState<TaskListFilter>("all");
    const statusMap = new Map(statuses.map((status) => [status.id, status]));
    const filteredTasks = useMemo(() => tasks.filter((task) => {
        if (filter === "active") return !task.completedAt;
        if (filter === "completed") return Boolean(task.completedAt);
        if (filter === "reminder") return Boolean(task.remindAt) && task.remindState !== "notified";
        if (filter === "linked") return Boolean(task.roomId);
        return true;
    }), [filter, tasks]);
    const filters: TaskListFilter[] = ["all", "active", "completed", "reminder", "linked"];

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
            <div className="border-b border-gray-100 px-3 py-2 dark:border-slate-800">
                <div className="flex flex-wrap gap-2">
                    {filters.map((item) => (
                        <button
                            key={item}
                            type="button"
                            onClick={() => setFilter(item)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                filter === item
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
                                    : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
                            }`}
                        >
                            {t(`tasks.filters.${item}`)}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
                {filteredTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {tasks.length === 0 ? t("tasks.empty") : t("tasks.emptyFiltered")}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filteredTasks.map((task) => (
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
                                {task.roomId && task.roomNameSnapshot && onOpenRoom ? (
                                    <div className="mb-2">
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onOpenRoom(task.roomId as string);
                                            }}
                                            className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-emerald-500 dark:hover:text-emerald-300"
                                        >
                                            {t("tasks.linkedRoomShort", { roomName: task.roomNameSnapshot })}
                                        </button>
                                    </div>
                                ) : null}
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
