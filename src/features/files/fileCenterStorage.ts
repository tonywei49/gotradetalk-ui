import { readUiStateFromSqlite, writeUiStateToSqlite } from "../../desktop/desktopCacheDb";
import type { FileLibraryItem } from "./fileCenterRepository";

const FILE_CENTER_SQLITE_SCOPE = "file-center";
const FILE_CENTER_STORAGE_PREFIX = "gtt_file_center_v1:";

export function buildFileCenterStorageKey(userId: string | null | undefined): string | null {
    const normalized = String(userId || "").trim();
    return normalized ? `${FILE_CENTER_STORAGE_PREFIX}${normalized}` : null;
}

export async function readStoredFileLibraryFromSqlite(storageKey: string | null): Promise<FileLibraryItem[] | null> {
    const cached = await readUiStateFromSqlite<FileLibraryItem[]>(FILE_CENTER_SQLITE_SCOPE, storageKey);
    return Array.isArray(cached) ? cached : null;
}

export async function writeStoredFileLibraryToSqlite(storageKey: string | null, items: FileLibraryItem[]): Promise<void> {
    if (!storageKey) return;
    await writeUiStateToSqlite(FILE_CENTER_SQLITE_SCOPE, storageKey, items);
}
