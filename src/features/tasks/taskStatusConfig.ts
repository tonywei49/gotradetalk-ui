import type { TFunction } from "i18next";
import type { TaskStatus, TaskStatusColor } from "./types";

type TaskStatusDefinition = {
    id: string;
    translationKey: string;
    color: TaskStatusColor;
    sortOrder: number;
};

export const TASK_STATUS_DEFINITIONS: TaskStatusDefinition[] = [
    { id: "preparing", translationKey: "tasks.status.preparing", color: "gray", sortOrder: 10 },
    { id: "pending_review", translationKey: "tasks.status.pendingReview", color: "amber", sortOrder: 20 },
    { id: "in_progress", translationKey: "tasks.status.inProgress", color: "blue", sortOrder: 30 },
    { id: "waiting_reply", translationKey: "tasks.status.waitingReply", color: "purple", sortOrder: 40 },
    { id: "blocked", translationKey: "tasks.status.blocked", color: "red", sortOrder: 50 },
    { id: "completed", translationKey: "tasks.status.completed", color: "green", sortOrder: 60 },
];

export function buildTaskStatuses(t: TFunction): TaskStatus[] {
    return TASK_STATUS_DEFINITIONS.map((status) => ({
        id: status.id,
        name: t(status.translationKey),
        color: status.color,
        sortOrder: status.sortOrder,
    }));
}

export function getDefaultTaskStatusId(): string {
    return TASK_STATUS_DEFINITIONS[0]?.id ?? "preparing";
}

export function isCompletedTaskStatus(statusId: string): boolean {
    return statusId === "completed";
}
