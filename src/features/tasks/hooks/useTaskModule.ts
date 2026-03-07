import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    createTask as createHubTask,
    deleteTask as deleteHubTask,
    listTasks as listHubTasks,
    updateTask as updateHubTask,
} from "../../../api/hub";
import type { TaskDraft, TaskItem, TaskReminderState, TaskStatus } from "../types";
import { buildTaskStatuses, getDefaultTaskStatusId, isCompletedTaskStatus } from "../taskStatusConfig";
import { buildTaskStorageKey, clearStoredTasks, readStoredTasks, writeStoredTasks } from "../taskStorage";

const EMPTY_DRAFT: TaskDraft = {
    title: "",
    content: "",
    statusId: getDefaultTaskStatusId(),
    remindAt: "",
    roomId: null,
    roomNameSnapshot: null,
};

function toDateInputValue(value: string | null | undefined): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "";
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    const hh = String(parsed.getHours()).padStart(2, "0");
    const min = String(parsed.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function toIsoOrNull(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatDate(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return `${parsed.getFullYear()}/${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

export function sortTasks(tasks: TaskItem[]): TaskItem[] {
    return [...tasks].sort((a, b) => {
        const aDone = a.completedAt ? 1 : 0;
        const bDone = b.completedAt ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
}

type RemoteTaskAuth = {
    accessToken: string | null;
    hsUrl?: string | null;
    matrixUserId?: string | null;
};

function toTaskMutationPayload(task: TaskItem) {
    return {
        title: task.title,
        content: task.content,
        statusId: task.statusId,
        remindAt: task.remindAt,
        remindState: task.remindState,
        snoozedUntil: task.snoozedUntil,
        roomId: task.roomId,
        roomNameSnapshot: task.roomNameSnapshot,
        createdBy: task.createdBy,
        completedAt: task.completedAt,
    };
}

async function createRemoteTask(task: TaskItem, auth: RemoteTaskAuth): Promise<TaskItem> {
    if (!auth.accessToken) return task;
    return await createHubTask({
        accessToken: auth.accessToken,
        hsUrl: auth.hsUrl,
        matrixUserId: auth.matrixUserId,
        body: toTaskMutationPayload(task),
    });
}

async function updateRemoteTask(taskId: string, patch: Partial<TaskItem>, auth: RemoteTaskAuth): Promise<TaskItem | null> {
    if (!auth.accessToken) return null;
    return await updateHubTask({
        accessToken: auth.accessToken,
        id: taskId,
        hsUrl: auth.hsUrl,
        matrixUserId: auth.matrixUserId,
        body: {
            title: patch.title,
            content: patch.content,
            statusId: patch.statusId,
            remindAt: patch.remindAt,
            remindState: patch.remindState,
            snoozedUntil: patch.snoozedUntil,
            roomId: patch.roomId,
            roomNameSnapshot: patch.roomNameSnapshot,
            createdBy: patch.createdBy,
            completedAt: patch.completedAt,
        },
    });
}

export type TaskModuleState = ReturnType<typeof useTaskModule>;

export function useTaskModule(params: {
    userId: string | null;
    activeRoomId: string | null;
    activeRoomName?: string | null;
    accessToken?: string | null;
    hsUrl?: string | null;
    matrixUserId?: string | null;
}) {
    const { t } = useTranslation();
    const { userId, activeRoomId, activeRoomName, accessToken = null, hsUrl = null, matrixUserId = null } = params;
    const statuses = useMemo<TaskStatus[]>(() => buildTaskStatuses(t), [t]);
    const storageKey = useMemo(() => buildTaskStorageKey(userId), [userId]);
    const remoteAuth = useMemo<RemoteTaskAuth>(() => ({ accessToken, hsUrl, matrixUserId }), [accessToken, hsUrl, matrixUserId]);
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [detailDraft, setDetailDraft] = useState<TaskDraft>(EMPTY_DRAFT);
    const [quickDraft, setQuickDraft] = useState<TaskDraft>(EMPTY_DRAFT);
    const [hydrated, setHydrated] = useState(false);
    const [nowTs, setNowTs] = useState(() => Date.now());

    useEffect(() => {
        if (!storageKey) {
            setTasks([]);
            setSelectedTaskId(null);
            setEditing(false);
            setDetailDraft(EMPTY_DRAFT);
            setQuickDraft(EMPTY_DRAFT);
            setHydrated(false);
            return;
        }

        let cancelled = false;
        const legacyTasks = sortTasks(readStoredTasks(window.localStorage, storageKey));

        const hydrate = async (): Promise<void> => {
            if (!accessToken) {
                if (!cancelled) {
                    setTasks(legacyTasks);
                    setHydrated(true);
                }
                return;
            }

            try {
                const remoteItems = sortTasks((await listHubTasks({
                    accessToken,
                    hsUrl,
                    matrixUserId,
                })).items);

                let nextTasks = remoteItems;
                if (remoteItems.length === 0 && legacyTasks.length > 0) {
                    const migrated: TaskItem[] = [];
                    for (const legacyTask of legacyTasks) {
                        migrated.push(await createRemoteTask(legacyTask, remoteAuth));
                    }
                    clearStoredTasks(window.localStorage, storageKey);
                    nextTasks = sortTasks(migrated);
                }

                if (!cancelled) {
                    setTasks(nextTasks);
                    setHydrated(true);
                }
            } catch (error) {
                console.error("Failed to load remote tasks", error);
                if (!cancelled) {
                    setTasks(legacyTasks);
                    setHydrated(true);
                }
            }
        };

        setHydrated(false);
        void hydrate();

        return () => {
            cancelled = true;
        };
    }, [accessToken, hsUrl, matrixUserId, remoteAuth, storageKey]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNowTs(Date.now());
        }, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!storageKey || !hydrated || accessToken) return;
        writeStoredTasks(window.localStorage, storageKey, tasks);
    }, [accessToken, hydrated, storageKey, tasks]);

    const sortedTasks = useMemo(() => sortTasks(tasks), [tasks]);
    const selectedTask = useMemo(
        () => sortedTasks.find((task) => task.id === selectedTaskId) ?? null,
        [sortedTasks, selectedTaskId],
    );
    const roomTasks = useMemo(
        () => sortedTasks.filter((task) => task.roomId === activeRoomId),
        [sortedTasks, activeRoomId],
    );
    const currentReminder = useMemo(() => {
        return sortedTasks.find((task) => {
            if (!task.remindAt) return false;
            if (task.remindState === "notified") return false;
            if (task.snoozedUntil && Date.parse(task.snoozedUntil) > nowTs) return false;
            return Date.parse(task.remindAt) <= nowTs;
        }) ?? null;
    }, [nowTs, sortedTasks]);

    useEffect(() => {
        if (!selectedTask) {
            setDetailDraft(EMPTY_DRAFT);
            setEditing(false);
            return;
        }
        setDetailDraft({
            title: selectedTask.title,
            content: selectedTask.content,
            statusId: selectedTask.statusId,
            remindAt: toDateInputValue(selectedTask.remindAt),
            roomId: selectedTask.roomId,
            roomNameSnapshot: selectedTask.roomNameSnapshot,
        });
    }, [selectedTask]);

    useEffect(() => {
        setQuickDraft((prev) => ({
            ...prev,
            roomId: activeRoomId,
            roomNameSnapshot: activeRoomName ?? null,
        }));
    }, [activeRoomId, activeRoomName]);

    const createTask = (): void => {
        const now = new Date().toISOString();
        const next: TaskItem = {
            id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: "",
            content: "",
            statusId: statuses[0]?.id || getDefaultTaskStatusId(),
            remindAt: null,
            remindState: "pending",
            snoozedUntil: null,
            roomId: null,
            roomNameSnapshot: null,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        };

        if (!accessToken) {
            setTasks((prev) => sortTasks([next, ...prev]));
            setSelectedTaskId(next.id);
            setEditing(true);
            return;
        }

        void (async () => {
            try {
                const created = await createRemoteTask(next, remoteAuth);
                setTasks((prev) => sortTasks([created, ...prev]));
                setSelectedTaskId(created.id);
                setEditing(true);
            } catch (error) {
                console.error("Failed to create task", error);
            }
        })();
    };

    const saveSelectedTask = (): void => {
        if (!selectedTask) return;
        const now = new Date().toISOString();
        const remindAtIso = toIsoOrNull(detailDraft.remindAt);
        const completed = isCompletedTaskStatus(detailDraft.statusId);
        const nextTask: TaskItem = {
            ...selectedTask,
            title: detailDraft.title.trim(),
            content: detailDraft.content.trim(),
            statusId: detailDraft.statusId,
            remindAt: remindAtIso,
            remindState: remindAtIso ? ("pending" as TaskReminderState) : "notified",
            snoozedUntil: null,
            roomId: detailDraft.roomId ?? null,
            roomNameSnapshot: detailDraft.roomNameSnapshot ?? null,
            updatedAt: now,
            completedAt: completed ? selectedTask.completedAt ?? now : null,
        };

        if (!accessToken) {
            setTasks((prev) => prev.map((task) => task.id === selectedTask.id ? nextTask : task));
            setEditing(false);
            return;
        }

        void (async () => {
            try {
                const saved = await updateRemoteTask(selectedTask.id, nextTask, remoteAuth);
                if (saved) {
                    setTasks((prev) => prev.map((task) => task.id === selectedTask.id ? saved : task));
                }
                setEditing(false);
            } catch (error) {
                console.error("Failed to save task", error);
            }
        })();
    };

    const deleteSelectedTask = (): void => {
        if (!selectedTask) return;

        if (!accessToken) {
            setTasks((prev) => prev.filter((task) => task.id !== selectedTask.id));
            setSelectedTaskId(null);
            setEditing(false);
            return;
        }

        void (async () => {
            try {
                await deleteHubTask({
                    accessToken,
                    id: selectedTask.id,
                    hsUrl,
                    matrixUserId,
                });
                setTasks((prev) => prev.filter((task) => task.id !== selectedTask.id));
                setSelectedTaskId(null);
                setEditing(false);
            } catch (error) {
                console.error("Failed to delete task", error);
            }
        })();
    };

    const createQuickTask = (): void => {
        if (!quickDraft.title.trim() && !quickDraft.content.trim()) return;
        const now = new Date().toISOString();
        const remindAtIso = toIsoOrNull(quickDraft.remindAt);
        const next: TaskItem = {
            id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: quickDraft.title.trim(),
            content: quickDraft.content.trim(),
            statusId: quickDraft.statusId,
            remindAt: remindAtIso,
            remindState: remindAtIso ? "pending" : "notified",
            snoozedUntil: null,
            roomId: quickDraft.roomId ?? null,
            roomNameSnapshot: quickDraft.roomNameSnapshot ?? null,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
            completedAt: isCompletedTaskStatus(quickDraft.statusId) ? now : null,
        };

        const resetQuickDraft = () => {
            setQuickDraft({
                ...EMPTY_DRAFT,
                roomId: activeRoomId,
                roomNameSnapshot: activeRoomName ?? null,
            });
        };

        if (!accessToken) {
            setTasks((prev) => sortTasks([next, ...prev]));
            setSelectedTaskId(next.id);
            resetQuickDraft();
            return;
        }

        void (async () => {
            try {
                const created = await createRemoteTask(next, remoteAuth);
                setTasks((prev) => sortTasks([created, ...prev]));
                setSelectedTaskId(created.id);
                resetQuickDraft();
            } catch (error) {
                console.error("Failed to create room task", error);
            }
        })();
    };

    const snoozeReminder = (): void => {
        if (!currentReminder) return;
        const nextTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const patch: Partial<TaskItem> = {
            remindState: "snoozed",
            snoozedUntil: nextTime,
            updatedAt: new Date().toISOString(),
        };

        if (!accessToken) {
            setTasks((prev) => prev.map((task) => task.id === currentReminder.id ? { ...task, ...patch } : task));
            return;
        }

        void (async () => {
            try {
                const saved = await updateRemoteTask(currentReminder.id, patch, remoteAuth);
                if (!saved) return;
                setTasks((prev) => prev.map((task) => task.id === currentReminder.id ? saved : task));
            } catch (error) {
                console.error("Failed to snooze task reminder", error);
            }
        })();
    };

    const dismissReminder = (): void => {
        if (!currentReminder) return;
        const patch: Partial<TaskItem> = {
            remindState: "notified",
            snoozedUntil: null,
            updatedAt: new Date().toISOString(),
        };

        if (!accessToken) {
            setTasks((prev) => prev.map((task) => task.id === currentReminder.id ? { ...task, ...patch } : task));
            return;
        }

        void (async () => {
            try {
                const saved = await updateRemoteTask(currentReminder.id, patch, remoteAuth);
                if (!saved) return;
                setTasks((prev) => prev.map((task) => task.id === currentReminder.id ? saved : task));
            } catch (error) {
                console.error("Failed to dismiss task reminder", error);
            }
        })();
    };

    const updateTaskStatus = (taskId: string, statusId: string): void => {
        const now = new Date().toISOString();
        const current = tasks.find((task) => task.id === taskId);
        if (!current) return;
        const completed = isCompletedTaskStatus(statusId);
        const patch: Partial<TaskItem> = {
            statusId,
            updatedAt: now,
            completedAt: completed ? current.completedAt ?? now : null,
        };

        if (!accessToken) {
            setTasks((prev) => prev.map((task) => task.id === taskId ? { ...task, ...patch } : task));
            if (selectedTaskId === taskId) {
                setDetailDraft((prev) => ({ ...prev, statusId }));
            }
            return;
        }

        void (async () => {
            try {
                const saved = await updateRemoteTask(taskId, patch, remoteAuth);
                if (!saved) return;
                setTasks((prev) => prev.map((task) => task.id === taskId ? saved : task));
                if (selectedTaskId === taskId) {
                    setDetailDraft((prev) => ({ ...prev, statusId }));
                }
            } catch (error) {
                console.error("Failed to update task status", error);
            }
        })();
    };

    const openTaskRoom = (taskId: string): string | null => {
        const target = tasks.find((task) => task.id === taskId);
        return target?.roomId ?? null;
    };

    return {
        statuses,
        tasks: sortedTasks.map((task) => ({
            ...task,
            createdAt: formatDate(task.createdAt),
        })),
        rawTasks: sortedTasks,
        selectedTaskId,
        selectedTask: selectedTask
            ? { ...selectedTask, createdAt: formatDate(selectedTask.createdAt) }
            : null,
        detailDraft,
        quickDraft,
        editing,
        roomTasks: roomTasks.map((task) => ({ ...task, createdAt: formatDate(task.createdAt) })),
        currentReminder: currentReminder ? { ...currentReminder, createdAt: formatDate(currentReminder.createdAt) } : null,
        setSelectedTaskId,
        setDetailDraft: (patch: Partial<TaskDraft>) => setDetailDraft((prev) => ({ ...prev, ...patch })),
        setQuickDraft: (patch: Partial<TaskDraft>) => setQuickDraft((prev) => ({ ...prev, ...patch })),
        setEditing,
        createTask,
        saveSelectedTask,
        deleteSelectedTask,
        createQuickTask,
        snoozeReminder,
        dismissReminder,
        updateTaskStatus,
        openTaskRoom,
    };
}
