import type { TaskItem } from "./types";

const TASKS_STORAGE_PREFIX = "gtt_tasks_v1:";

export type TaskStorageLike = Pick<Storage, "getItem" | "setItem">;

export function buildTaskStorageKey(userId: string | null | undefined): string | null {
    const normalized = String(userId || "").trim();
    return normalized ? `${TASKS_STORAGE_PREFIX}${normalized}` : null;
}

export function readStoredTasks(storage: TaskStorageLike, storageKey: string | null): TaskItem[] {
    if (!storageKey) return [];
    try {
        const raw = storage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as TaskItem[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function writeStoredTasks(storage: TaskStorageLike, storageKey: string | null, tasks: TaskItem[]): void {
    if (!storageKey) return;
    storage.setItem(storageKey, JSON.stringify(tasks));
}

export function clearStoredTasks(storage: Storage, storageKey: string | null): void {
    if (!storageKey) return;
    storage.removeItem(storageKey);
}
