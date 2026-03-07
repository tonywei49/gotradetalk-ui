import type { TaskItem, TaskStatus } from "./types";

export type TaskListFilter = "all" | "reminder" | "linked" | `status:${string}`;

export function filterTaskItems(tasks: TaskItem[], filter: TaskListFilter): TaskItem[] {
    return tasks.filter((task) => {
        if (filter === "reminder") return Boolean(task.remindAt) && task.remindState !== "notified";
        if (filter === "linked") return Boolean(task.roomId);
        if (filter.startsWith("status:")) return task.statusId === filter.slice(7);
        return true;
    });
}

export function buildPrimaryTaskFilters(t: (key: string) => string): Array<{ id: TaskListFilter; label: string }> {
    return [
        { id: "all", label: t("tasks.filters.all") },
        { id: "reminder", label: t("tasks.filters.reminder") },
        { id: "linked", label: t("tasks.filters.linked") },
    ];
}

export function buildStatusTaskFilters(statuses: TaskStatus[]): Array<{ id: TaskListFilter; label: string }> {
    return statuses.map((status) => ({
        id: `status:${status.id}` as TaskListFilter,
        label: status.name,
    }));
}

export function isTaskStatusFilter(filter: TaskListFilter): boolean {
    return filter.startsWith("status:");
}
