export type TaskStatusColor = "gray" | "amber" | "blue" | "green" | "red";

export type TaskReminderState = "pending" | "snoozed" | "notified";

export type TaskStatus = {
    id: string;
    name: string;
    color: TaskStatusColor;
    sortOrder: number;
};

export type TaskItem = {
    id: string;
    title: string;
    content: string;
    statusId: string;
    remindAt: string | null;
    remindState: TaskReminderState;
    snoozedUntil: string | null;
    roomId: string | null;
    roomNameSnapshot: string | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
};

export type TaskDraft = {
    title: string;
    content: string;
    statusId: string;
    remindAt: string;
    roomId?: string | null;
    roomNameSnapshot?: string | null;
};
