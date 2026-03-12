import { MatrixClient, MatrixScheduler, MemoryStore } from "matrix-js-sdk";
import { IndexedDBStore } from "matrix-js-sdk/lib/store/indexeddb";
import { logger as matrixLogger } from "matrix-js-sdk/lib/logger";

type MatrixClientConfig = {
    baseUrl: string;
    accessToken: string;
    userId: string;
    deviceId?: string;
};

const clientStartupMap = new WeakMap<MatrixClient, Promise<void>>();

function getMatrixStoreName(userId: string): string {
    return `gtt-matrix-store-${userId.replace(/[^a-z0-9_.-]/gi, "_")}`;
}

function createMatrixStore(userId: string): MemoryStore | IndexedDBStore {
    const storage = typeof window === "undefined" ? undefined : window.localStorage;
    if (typeof window === "undefined" || !window.indexedDB) {
        return new MemoryStore({ localStorage: storage });
    }

    try {
        return new IndexedDBStore({
            indexedDB: window.indexedDB,
            localStorage: storage,
            dbName: getMatrixStoreName(userId),
        });
    } catch (error) {
        console.warn("Failed to initialize IndexedDBStore, falling back to MemoryStore:", error);
        return new MemoryStore({ localStorage: storage });
    }
}

export async function prepareMatrixClient(client: MatrixClient | null): Promise<void> {
    if (!client) return;
    await clientStartupMap.get(client);
}

export function createMatrixClient(config: MatrixClientConfig): MatrixClient {
    // Force SDK logs to warn+ to avoid noisy sync payload output in production browsers.
    (matrixLogger as unknown as { setLevel?: (level: string, persist?: boolean) => void }).setLevel?.("warn", false);
    const store = createMatrixStore(config.userId);
    const scheduler = new MatrixScheduler();

    // We intentionally avoid initializing crypto to keep E2EE disabled.
    const client = new MatrixClient({
        baseUrl: config.baseUrl,
        accessToken: config.accessToken,
        userId: config.userId,
        deviceId: config.deviceId,
        timelineSupport: true,
        useAuthorizationHeader: true,
        store,
        scheduler,
    });

    const startup = store instanceof IndexedDBStore
        ? store.startup().catch((error) => {
            console.warn("Failed to restore Matrix IndexedDB store:", error);
        })
        : Promise.resolve();
    clientStartupMap.set(client, startup);

    return client;
}
