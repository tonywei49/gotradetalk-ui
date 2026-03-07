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
    chatContext: TaskChatContext;
} {
    const listProps = useMemo<TaskListProps>(() => ({
        tasks: taskModule.tasks,
        statuses: taskModule.statuses,
        selectedTaskId: taskModule.selectedTaskId,
        onSelectTask: (taskId) => {
            taskModule.setSelectedTaskId(taskId);
            onMobileDetail();
        },
        onCreateTask: () => {
            taskModule.createTask();
            onMobileDetail();
        },
        onOpenRoom,
    }), [onMobileDetail, onOpenRoom, taskModule]);

    const detailProps = useMemo<TaskDetailProps>(() => ({
        task: taskModule.selectedTask,
        statuses: taskModule.statuses,
        draft: taskModule.detailDraft,
        editing: taskModule.editing,
        onDraftChange: taskModule.setDetailDraft,
        onStartEdit: () => taskModule.setEditing(true),
        onSave: taskModule.saveSelectedTask,
        onDelete: taskModule.deleteSelectedTask,
        onMobileBack: onMobileList,
        onOpenLinkedRoom: onOpenRoom,
    }), [onMobileList, onOpenRoom, taskModule]);

    const reminderProps = useMemo<TaskReminderBannerProps>(() => ({
        task: taskModule.currentReminder,
        onSnooze: taskModule.snoozeReminder,
        onDismiss: taskModule.dismissReminder,
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

    return { listProps, detailProps, reminderProps, chatContext };
}
