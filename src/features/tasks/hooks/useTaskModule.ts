import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    createTask as createHubTask,
    deleteTask as deleteHubTask,
    listTasks as listHubTasks,
    updateTask as updateHubTask,
} from "../../../api/hub";
import type { TaskDraft, TaskItem, TaskReminderState, TaskStatus } from "../types";
import { buildTaskStatuses, getDefaultTaskStatusId, isCompletedTaskStatus } from "../taskStatusConfig";
import {
    buildTaskStorageKey,
    clearStoredTasks,
    readStoredTasks,
    readStoredTasksFromSqlite,
    writeStoredTasks,
    writeStoredTasksToSqlite,
} from "../taskStorage";

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
    const [creatingTask, setCreatingTask] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);
    const syncInFlightRef = useRef<Promise<TaskItem[] | null> | null>(null);

    const loadRemoteTasks = useCallback(async (): Promise<TaskItem[]> => {
        if (!accessToken) return [];
        return sortTasks((await listHubTasks({
            accessToken,
            hsUrl,
            matrixUserId,
        })).items);
    }, [accessToken, hsUrl, matrixUserId]);

    const syncTasks = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
        if (!accessToken || !storageKey) return false;
        if (syncInFlightRef.current) {
            const existing = await syncInFlightRef.current;
            return Boolean(existing);
        }

        const silent = options?.silent ?? false;
        const task = (async (): Promise<TaskItem[] | null> => {
            if (!silent) {
                setSyncing(true);
            }
            setSyncError(null);
            try {
                const remoteItems = await loadRemoteTasks();
                setTasks(remoteItems);
                setLastSyncedAt(new Date().toISOString());
                return remoteItems;
            } catch (error) {
                console.error("Failed to sync tasks", error);
                setSyncError(error instanceof Error ? error.message : "sync_failed");
                return null;
            } finally {
                if (!silent) {
                    setSyncing(false);
                }
                syncInFlightRef.current = null;
            }
        })();

        syncInFlightRef.current = task;
        const result = await task;
        return Boolean(result);
    }, [accessToken, loadRemoteTasks, storageKey]);

    useEffect(() => {
        if (!storageKey) {
            setTasks([]);
            setSelectedTaskId(null);
            setEditing(false);
            setDetailDraft(EMPTY_DRAFT);
            setQuickDraft(EMPTY_DRAFT);
            setHydrated(false);
            setSyncing(false);
            setLastSyncedAt(null);
            setSyncError(null);
            return;
        }

        let cancelled = false;
        const legacyTasks = sortTasks(readStoredTasks(window.localStorage, storageKey));

        const hydrate = async (): Promise<void> => {
            const sqliteTasks = sortTasks((await readStoredTasksFromSqlite(storageKey)) ?? []);
            const cachedTasks = sqliteTasks.length > 0 ? sqliteTasks : legacyTasks;

            if (!accessToken) {
                if (!cancelled) {
                    setTasks(cachedTasks);
                    setHydrated(true);
                }
                return;
            }

            try {
                const remoteItems = await loadRemoteTasks();

                let nextTasks = remoteItems;
                if (remoteItems.length === 0 && cachedTasks.length > 0) {
                    const migrated: TaskItem[] = [];
                    for (const legacyTask of cachedTasks) {
                        migrated.push(await createRemoteTask(legacyTask, remoteAuth));
                    }
                    clearStoredTasks(window.localStorage, storageKey);
                    nextTasks = sortTasks(migrated);
                }

                if (!cancelled) {
                    setTasks(nextTasks);
                    setLastSyncedAt(new Date().toISOString());
                    setSyncError(null);
                    setHydrated(true);
                }
            } catch (error) {
                console.error("Failed to load remote tasks", error);
                if (!cancelled) {
                    setTasks(cachedTasks);
                    setSyncError(error instanceof Error ? error.message : "load_failed");
                    setHydrated(true);
                }
            }
        };

        setHydrated(false);
        void hydrate();

        return () => {
            cancelled = true;
        };
    }, [accessToken, loadRemoteTasks, remoteAuth, storageKey]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNowTs(Date.now());
        }, 30_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!storageKey || !hydrated) return;
        writeStoredTasks(window.localStorage, storageKey, tasks);
        void writeStoredTasksToSqlite(storageKey, tasks);
    }, [hydrated, storageKey, tasks]);

    useEffect(() => {
        if (!accessToken || !hydrated) return undefined;
        const timer = window.setInterval(() => {
            void syncTasks({ silent: true });
        }, 60_000);
        return () => window.clearInterval(timer);
    }, [accessToken, hydrated, syncTasks]);

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
            if (!creatingTask) {
                setEditing(false);
            }
            return;
        }
        setCreatingTask(false);
        setDetailDraft({
            title: selectedTask.title,
            content: selectedTask.content,
            statusId: selectedTask.statusId,
            remindAt: toDateInputValue(selectedTask.remindAt),
            roomId: selectedTask.roomId,
            roomNameSnapshot: selectedTask.roomNameSnapshot,
        });
    }, [creatingTask, selectedTask]);

    useEffect(() => {
        setQuickDraft((prev) => ({
            ...prev,
            roomId: activeRoomId,
            roomNameSnapshot: activeRoomName ?? null,
        }));
    }, [activeRoomId, activeRoomName]);

    const createTask = (): void => {
        setCreatingTask(true);
        setSelectedTaskId(null);
        setDetailDraft({
            ...EMPTY_DRAFT,
            statusId: statuses[0]?.id || getDefaultTaskStatusId(),
            roomId: activeRoomId,
            roomNameSnapshot: activeRoomName ?? null,
        });
        setEditing(true);
    };

    const saveSelectedTask = async (): Promise<boolean> => {
        const now = new Date().toISOString();
        const remindAtIso = toIsoOrNull(detailDraft.remindAt);
        const completed = isCompletedTaskStatus(detailDraft.statusId);
        const draftTaskBase: TaskItem = {
            id: selectedTask?.id ?? `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: detailDraft.title.trim(),
            content: detailDraft.content.trim(),
            statusId: detailDraft.statusId,
            remindAt: remindAtIso,
            remindState: remindAtIso ? ("pending" as TaskReminderState) : "notified",
            snoozedUntil: null,
            roomId: detailDraft.roomId ?? null,
            roomNameSnapshot: detailDraft.roomNameSnapshot ?? null,
            createdBy: selectedTask?.createdBy ?? userId,
            createdAt: selectedTask?.createdAt ?? now,
            updatedAt: now,
            completedAt: completed ? (selectedTask?.completedAt ?? now) : null,
        };

        if (creatingTask || !selectedTask) {
            if (!accessToken) {
                setTasks((prev) => sortTasks([draftTaskBase, ...prev]));
                setSelectedTaskId(draftTaskBase.id);
                setCreatingTask(false);
                setEditing(false);
                return true;
            }

            try {
                const created = await createRemoteTask(draftTaskBase, remoteAuth);
                setTasks((prev) => sortTasks([created, ...prev]));
                setSelectedTaskId(created.id);
                setCreatingTask(false);
                setEditing(false);
                return true;
            } catch (error) {
                console.error("Failed to create task", error);
                return false;
            }
        }

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
            return true;
        }

        try {
            const saved = await updateRemoteTask(selectedTask.id, nextTask, remoteAuth);
            if (saved) {
                setTasks((prev) => prev.map((task) => task.id === selectedTask.id ? saved : task));
            }
            setEditing(false);
            return true;
        } catch (error) {
            console.error("Failed to save task", error);
            return false;
        }
    };

    const deleteSelectedTask = async (): Promise<boolean> => {
        if (creatingTask && !selectedTask) {
            setCreatingTask(false);
            setSelectedTaskId(null);
            setEditing(false);
            setDetailDraft(EMPTY_DRAFT);
            return true;
        }
        if (!selectedTask) return false;

        if (!accessToken) {
            setTasks((prev) => prev.filter((task) => task.id !== selectedTask.id));
            setSelectedTaskId(null);
            setEditing(false);
            return true;
        }

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
            return true;
        } catch (error) {
            console.error("Failed to delete task", error);
            return false;
        }
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

    const cancelEditing = (): void => {
        if (creatingTask) {
            setCreatingTask(false);
            setSelectedTaskId(null);
            setEditing(false);
            setDetailDraft(EMPTY_DRAFT);
            return;
        }
        if (!selectedTask) {
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
        setEditing(false);
    };

    return {
        hydrated,
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
        creatingTask,
        syncing,
        lastSyncedAt,
        syncError,
        roomTasks: roomTasks.map((task) => ({ ...task, createdAt: formatDate(task.createdAt) })),
        currentReminder: currentReminder ? { ...currentReminder, createdAt: formatDate(currentReminder.createdAt) } : null,
        setSelectedTaskId,
        setDetailDraft: (patch: Partial<TaskDraft>) => setDetailDraft((prev) => ({ ...prev, ...patch })),
        setQuickDraft: (patch: Partial<TaskDraft>) => setQuickDraft((prev) => ({ ...prev, ...patch })),
        setEditing,
        createTask,
        saveSelectedTask,
        deleteSelectedTask,
        cancelEditing,
        syncTasks,
        createQuickTask,
        snoozeReminder,
        dismissReminder,
        updateTaskStatus,
        openTaskRoom,
    };
}
