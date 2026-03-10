import Database from "@tauri-apps/plugin-sql";
import { isTauriDesktop } from "../../desktop/fetchWithDesktopSupport";

const NOTEBOOK_CACHE_DB = "sqlite:notebook-cache.db";

let dbPromise: Promise<Database> | null = null;

export async function getNotebookCacheDb(): Promise<Database | null> {
    if (!isTauriDesktop()) return null;
    if (!dbPromise) {
        dbPromise = Database.load(NOTEBOOK_CACHE_DB);
    }
    return dbPromise;
}
