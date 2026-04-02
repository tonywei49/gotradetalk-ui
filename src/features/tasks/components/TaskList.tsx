import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskItem, TaskStatus } from "../types";
import { getTaskStatusBadgeClass } from "../statusStyles";
import {
    buildPrimaryTaskFilters,
    buildStatusTaskFilters,
    filterTaskItems,
    isTaskStatusFilter,
    type TaskListFilter,
} from "../taskFilters";

export type TaskListProps = {
    tasks: TaskItem[];
    statuses: TaskStatus[];
    selectedTaskId: string | null;
    onSelectTask: (taskId: string) => void;
    onCreateTask: () => void;
    onSyncTasks?: () => void | Promise<void>;
    syncing?: boolean;
    syncError?: string | null;
    onOpenRoom?: (roomId: string) => void;
};

export function TaskList({
    tasks,
    statuses,
    selectedTaskId,
    onSelectTask,
    onCreateTask,
    onSyncTasks,
    syncing = false,
    syncError = null,
    onOpenRoom,
}: TaskListProps) {
    const { t } = useTranslation();
    const [filter, setFilter] = useState<TaskListFilter>("all");
    const [showMoreFilters, setShowMoreFilters] = useState(false);
    const moreFiltersRef = useRef<HTMLDivElement | null>(null);
    const statusMap = new Map(statuses.map((status) => [status.id, status]));
    const filteredTasks = useMemo(() => filterTaskItems(tasks, filter), [filter, tasks]);
    const primaryFilters = useMemo(() => buildPrimaryTaskFilters(t), [t]);
    const statusFilters = useMemo(() => buildStatusTaskFilters(statuses), [statuses]);
    const moreFiltersActive = isTaskStatusFilter(filter);

    useEffect(() => {
        if (!showMoreFilters) return undefined;
        const handlePointerDown = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (moreFiltersRef.current?.contains(target ?? null)) return;
            setShowMoreFilters(false);
        };
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [showMoreFilters]);

    return (
        <div className="flex h-full flex-col bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 dark:border-slate-800">
                <div className="text-[13px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {t("tasks.title")}
                </div>
                <div className="flex items-center gap-2">
                    {onSyncTasks ? (
                        <button
                            type="button"
                            onClick={() => void onSyncTasks()}
                            disabled={syncing}
                            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-emerald-400 hover:text-emerald-600 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                        >
                            {syncing ? t("tasks.syncing") : t("tasks.sync")}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onCreateTask}
                        className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:text-slate-200"
                    >
                        {t("tasks.newTask")}
                    </button>
                </div>
            </div>
            {syncError ? (
                <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                    {syncError}
                </div>
            ) : null}
            <div className="border-b border-gray-100 px-3 py-3 dark:border-slate-800">
                <div className="flex flex-wrap gap-2">
                    {primaryFilters.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setFilter(item.id)}
                            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                                filter === item.id
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
                                    : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                    <div ref={moreFiltersRef} className="relative">
                        <button
                            type="button"
                            onClick={() => setShowMoreFilters((prev) => !prev)}
                            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
                                moreFiltersActive || showMoreFilters
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
                                    : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
                            }`}
                            aria-label={t("tasks.filters.more")}
                        >
                            ...
                        </button>
                        {showMoreFilters ? (
                            <div className="absolute left-0 top-[calc(100%+8px)] z-20 min-w-[160px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                                {statusFilters.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => {
                                            setFilter(item.id);
                                            setShowMoreFilters(false);
                                        }}
                                        className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold ${
                                            filter === item.id
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
                                                : "text-slate-600 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                                        }`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
                {filteredTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-base text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        {tasks.length === 0 ? t("tasks.empty") : t("tasks.emptyFiltered")}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filteredTasks.map((task) => {
                            const linkedRoomLabel = task.roomNameSnapshot || task.roomId || null;
                            return (
                            <button
                                key={task.id}
                                type="button"
                                onClick={() => onSelectTask(task.id)}
                                className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${
                                    selectedTaskId === task.id
                                        ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20"
                                        : "border-gray-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                                }`}
                            >
                                <div className="mb-1 truncate text-[17px] leading-6 font-semibold text-slate-800 dark:text-slate-100">
                                    {task.title || t("tasks.untitled")}
                                </div>
                                <div className="mb-3 line-clamp-2 text-[14px] leading-5 text-slate-500 dark:text-slate-400">
                                    {task.content || t("tasks.noDetails")}
                                </div>
                                <div className="flex items-center justify-between gap-2 text-[13px]">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span
                                            className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 ${getTaskStatusBadgeClass(statusMap.get(task.statusId)?.color)}`}
                                        >
                                            {statusMap.get(task.statusId)?.name || t("tasks.unknownStatus")}
                                        </span>
                                    </div>
                                    <div className="ml-auto flex min-w-0 items-center gap-2">
                                        {task.roomId && linkedRoomLabel && onOpenRoom ? (
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onOpenRoom(task.roomId as string);
                                                }}
                                                className="truncate rounded-md border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium text-slate-500 hover:border-emerald-400 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-emerald-500 dark:hover:text-emerald-300"
                                            >
                                                {t("tasks.linkedRoomShort", { roomName: linkedRoomLabel })}
                                            </button>
                                        ) : null}
                                        <span className="shrink-0 text-slate-400 dark:text-slate-500">
                                            {task.createdAt}
                                        </span>
                                    </div>
                                </div>
                            </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
