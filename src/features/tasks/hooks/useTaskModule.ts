import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TaskDraft, TaskItem, TaskReminderState, TaskStatus } from "../types";

const TASKS_STORAGE_PREFIX = "gtt_tasks_v1:";

const EMPTY_DRAFT: TaskDraft = {
    title: "",
    content: "",
    statusId: "preparing",
    remindAt: "",
    roomId: null,
    roomNameSnapshot: null,
};

function buildStorageKey(userId: string | null | undefined): string | null {
    const normalized = String(userId || "").trim();
    return normalized ? `${TASKS_STORAGE_PREFIX}${normalized}` : null;
}

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

function sortTasks(tasks: TaskItem[]): TaskItem[] {
    return [...tasks].sort((a, b) => {
        const aDone = a.completedAt ? 1 : 0;
        const bDone = b.completedAt ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
}

export function useTaskModule(params: { userId: string | null; activeRoomId: string | null; activeRoomName?: string | null }) {
    const { t } = useTranslation();
    const { userId, activeRoomId, activeRoomName } = params;
    const statuses = useMemo<TaskStatus[]>(() => ([
        { id: "preparing", name: t("tasks.status.preparing"), color: "gray", sortOrder: 10 },
        { id: "pending_review", name: t("tasks.status.pendingReview"), color: "amber", sortOrder: 20 },
        { id: "in_progress", name: t("tasks.status.inProgress"), color: "blue", sortOrder: 30 },
        { id: "waiting_reply", name: t("tasks.status.waitingReply"), color: "purple", sortOrder: 40 },
        { id: "blocked", name: t("tasks.status.blocked"), color: "red", sortOrder: 50 },
        { id: "completed", name: t("tasks.status.completed"), color: "green", sortOrder: 60 },
    ]), [t]);
    const storageKey = useMemo(() => buildStorageKey(userId), [userId]);
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
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) {
                setTasks([]);
                setHydrated(true);
                return;
            }
            const parsed = JSON.parse(raw) as TaskItem[];
            setTasks(Array.isArray(parsed) ? sortTasks(parsed) : []);
        } catch {
            setTasks([]);
        } finally {
            setHydrated(true);
        }
    }, [storageKey]);

    useEffect(() => {
        if (!storageKey || !hydrated) return;
        localStorage.setItem(storageKey, JSON.stringify(tasks));
    }, [storageKey, hydrated, tasks]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNowTs(Date.now());
        }, 30_000);
        return () => window.clearInterval(timer);
    }, []);

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
            statusId: statuses[0]?.id || "preparing",
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
        setTasks((prev) => sortTasks([next, ...prev]));
        setSelectedTaskId(next.id);
        setEditing(true);
    };

    const saveSelectedTask = (): void => {
        if (!selectedTask) return;
        const now = new Date().toISOString();
        const remindAtIso = toIsoOrNull(detailDraft.remindAt);
        setTasks((prev) => prev.map((task) => {
            if (task.id !== selectedTask.id) return task;
            const completed = detailDraft.statusId === "completed";
            return {
                ...task,
                title: detailDraft.title.trim(),
                content: detailDraft.content.trim(),
                statusId: detailDraft.statusId,
                remindAt: remindAtIso,
                remindState: remindAtIso ? ("pending" as TaskReminderState) : "notified",
                snoozedUntil: null,
                roomId: detailDraft.roomId ?? null,
                roomNameSnapshot: detailDraft.roomNameSnapshot ?? null,
                updatedAt: now,
                completedAt: completed ? task.completedAt ?? now : null,
            };
        }));
        setEditing(false);
    };

    const deleteSelectedTask = (): void => {
        if (!selectedTask) return;
        setTasks((prev) => prev.filter((task) => task.id !== selectedTask.id));
        setSelectedTaskId(null);
        setEditing(false);
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
            completedAt: quickDraft.statusId === "completed" ? now : null,
        };
        setTasks((prev) => sortTasks([next, ...prev]));
        setSelectedTaskId(next.id);
        setQuickDraft({
            ...EMPTY_DRAFT,
            roomId: activeRoomId,
            roomNameSnapshot: activeRoomName ?? null,
        });
    };

    const snoozeReminder = (): void => {
        if (!currentReminder) return;
        const nextTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        setTasks((prev) => prev.map((task) => task.id === currentReminder.id
            ? { ...task, remindState: "snoozed", snoozedUntil: nextTime, updatedAt: new Date().toISOString() }
            : task));
    };

    const dismissReminder = (): void => {
        if (!currentReminder) return;
        setTasks((prev) => prev.map((task) => task.id === currentReminder.id
            ? { ...task, remindState: "notified", snoozedUntil: null, updatedAt: new Date().toISOString() }
            : task));
    };

    const updateTaskStatus = (taskId: string, statusId: string): void => {
        const now = new Date().toISOString();
        setTasks((prev) => prev.map((task) => {
            if (task.id !== taskId) return task;
            const completed = statusId === "completed";
            return {
                ...task,
                statusId,
                updatedAt: now,
                completedAt: completed ? task.completedAt ?? now : null,
            };
        }));
        if (selectedTaskId === taskId) {
            setDetailDraft((prev) => ({ ...prev, statusId }));
        }
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
