export type PendingClientRegistrationDraft = {
    email: string;
    userLocalId: string;
    companyName: string;
    country: string;
    translationLocale: string;
    jobTitle: string;
    gender: string;
    language: string;
    password: string;
    createdAt: number;
};

const STORAGE_KEY = "gtt_pending_client_registration_v2";
const MAX_DRAFT_AGE_MS = 2 * 60 * 60 * 1000;

export function readPendingClientRegistrationDraft(): PendingClientRegistrationDraft | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PendingClientRegistrationDraft;
        if (!parsed?.email || typeof parsed.email !== "string") return null;
        if (!parsed.password || typeof parsed.password !== "string") {
            window.localStorage.removeItem(STORAGE_KEY);
            return null;
        }
        if (!parsed.createdAt || Date.now() - parsed.createdAt > MAX_DRAFT_AGE_MS) {
            window.localStorage.removeItem(STORAGE_KEY);
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function writePendingClientRegistrationDraft(draft: Omit<PendingClientRegistrationDraft, "createdAt">): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...draft,
            createdAt: Date.now(),
        } satisfies PendingClientRegistrationDraft));
    } catch {
        // Ignore storage failures. Registration can still continue without a local draft.
    }
}

export function clearPendingClientRegistrationDraft(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore storage failures.
    }
}
