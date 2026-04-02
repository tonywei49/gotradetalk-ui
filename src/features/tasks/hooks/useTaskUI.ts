import { useMemo } from "react";
import type { TaskDraft, TaskItem, TaskStatus } from "../types";
import type { TaskListProps } from "../components/TaskList";
import type { TaskDetailProps } from "../components/TaskDetail";
import type { TaskReminderBannerProps } from "../components/TaskReminderBanner";
import type { TaskModuleState } from "./useTaskModule";

export type TaskChatContext = {
    taskStatuses?: TaskStatus[];
    roomTasks?: TaskItem[];
    taskQuickDraft?: TaskDraft;
    onTaskQuickDraftChange?: (patch: Partial<TaskDraft>) => void;
    onCreateRoomTask?: () => void;
    onOpenTasksTab?: () => void;
    onUpdateRoomTaskStatus?: (taskId: string, statusId: string) => void;
};

type UseTaskUIParams = {
    taskModule: TaskModuleState;
    onOpenRoom: (roomId: string) => void;
    onOpenTasksTab: () => void;
    onMobileDetail: () => void;
    onMobileList: () => void;
};

export function useTaskUI({
    taskModule,
    onOpenRoom,
    onOpenTasksTab,
    onMobileDetail,
    onMobileList,
}: UseTaskUIParams): {
    listProps: TaskListProps;
    detailProps: TaskDetailProps;
    reminderProps: TaskReminderBannerProps;
    chatReminderProps: TaskReminderBannerProps;
    chatContext: TaskChatContext;
} {
    const listProps = useMemo<TaskListProps>(() => ({
        tasks: taskModule.tasks,
        statuses: taskModule.statuses,
        selectedTaskId: taskModule.selectedTaskId,
        syncing: taskModule.syncing,
        syncError: taskModule.syncError,
        onSelectTask: (taskId) => {
            taskModule.setSelectedTaskId(taskId);
            onMobileDetail();
        },
        onCreateTask: () => {
            taskModule.createTask();
            onMobileDetail();
        },
        onSyncTasks: async () => {
            await taskModule.syncTasks();
        },
        onOpenRoom,
    }), [onMobileDetail, onOpenRoom, taskModule]);

    const detailProps = useMemo<TaskDetailProps>(() => ({
        task: taskModule.selectedTask,
        statuses: taskModule.statuses,
        draft: taskModule.detailDraft,
        editing: taskModule.editing,
        creating: taskModule.creatingTask,
        onDraftChange: taskModule.setDetailDraft,
        onStartEdit: () => taskModule.setEditing(true),
        onSave: async () => {
            const saved = await taskModule.saveSelectedTask();
            if (saved && taskModule.creatingTask) {
                onMobileList();
            }
        },
        onDelete: async () => {
            const deleted = await taskModule.deleteSelectedTask();
            if (deleted) {
                onMobileList();
            }
        },
        onCancelEdit: () => {
            taskModule.cancelEditing();
            if (taskModule.creatingTask) {
                onMobileList();
            }
        },
        onMobileBack: onMobileList,
        onOpenLinkedRoom: onOpenRoom,
    }), [onMobileList, onOpenRoom, taskModule]);

    const reminderProps = useMemo<TaskReminderBannerProps>(() => ({
        task: taskModule.currentReminder,
        onSnooze: () => taskModule.snoozeReminder(taskModule.currentReminder?.id ?? null),
        onDismiss: () => taskModule.dismissReminder(taskModule.currentReminder?.id ?? null),
    }), [taskModule]);

    const chatReminderProps = useMemo<TaskReminderBannerProps>(() => ({
        task: taskModule.currentRoomReminder,
        onSnooze: () => taskModule.snoozeReminder(taskModule.currentRoomReminder?.id ?? null),
        onDismiss: () => taskModule.dismissReminder(taskModule.currentRoomReminder?.id ?? null),
    }), [taskModule]);

    const chatContext = useMemo<TaskChatContext>(() => ({
        taskStatuses: taskModule.statuses,
        roomTasks: taskModule.roomTasks,
        taskQuickDraft: taskModule.quickDraft,
        onTaskQuickDraftChange: taskModule.setQuickDraft,
        onCreateRoomTask: taskModule.createQuickTask,
        onOpenTasksTab,
        onUpdateRoomTaskStatus: taskModule.updateTaskStatus,
    }), [onOpenTasksTab, taskModule]);

    return { listProps, detailProps, reminderProps, chatReminderProps, chatContext };
}
