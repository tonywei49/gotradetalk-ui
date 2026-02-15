export type PersistedTranslationCacheEntry = {
    text: string;
    updatedAt: number;
};

export type PersistedTranslationCacheRecord = Record<string, PersistedTranslationCacheEntry>;

function hashTextForTranslationCache(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 33) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

function buildTranslationCacheStorageKey(
    roomId: string,
    messageId: string,
    targetLanguage: string,
    sourceText: string,
): string {
    return `${roomId}|${messageId}|${targetLanguage}|${hashTextForTranslationCache(sourceText)}`;
}

export function createTranslationCacheStore(storageKey: string, maxItems: number) {
    let record: PersistedTranslationCacheRecord | null = null;

    const ensureLoaded = (): PersistedTranslationCacheRecord => {
        if (record) return record;
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) {
                record = {};
                return record;
            }
            const parsed = JSON.parse(raw) as PersistedTranslationCacheRecord;
            if (!parsed || typeof parsed !== "object") {
                record = {};
                return record;
            }
            record = parsed;
            return record;
        } catch {
            record = {};
            return record;
        }
    };

    const persist = (nextRecord: PersistedTranslationCacheRecord): void => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(nextRecord));
        } catch {
            // ignore persistence errors (quota/private mode)
        }
    };

    return {
        read(roomId: string, messageId: string, targetLanguage: string, sourceText: string): string | null {
            const loaded = ensureLoaded();
            const key = buildTranslationCacheStorageKey(roomId, messageId, targetLanguage, sourceText);
            return loaded[key]?.text ?? null;
        },
        write(
            roomId: string,
            messageId: string,
            targetLanguage: string,
            sourceText: string,
            translatedText: string,
        ): void {
            const loaded = ensureLoaded();
            const key = buildTranslationCacheStorageKey(roomId, messageId, targetLanguage, sourceText);
            loaded[key] = { text: translatedText, updatedAt: Date.now() };
            const keys = Object.keys(loaded);
            if (keys.length > maxItems) {
                keys
                    .sort((a, b) => (loaded[a]?.updatedAt ?? 0) - (loaded[b]?.updatedAt ?? 0))
                    .slice(0, keys.length - maxItems)
                    .forEach((expiredKey) => {
                        delete loaded[expiredKey];
                    });
            }
            persist(loaded);
        },
    };
}
