import { MatrixClient, MatrixScheduler, MemoryStore, PendingEventOrdering } from "matrix-js-sdk";

type MatrixClientConfig = {
    baseUrl: string;
    accessToken: string;
    userId: string;
    deviceId?: string;
};

export function createMatrixClient(config: MatrixClientConfig): MatrixClient {
    const storage = typeof window === "undefined" ? undefined : window.localStorage;
    const store = new MemoryStore({ localStorage: storage });
    const scheduler = new MatrixScheduler();

    // We intentionally avoid initializing crypto to keep E2EE disabled.
    return new MatrixClient({
        baseUrl: config.baseUrl,
        accessToken: config.accessToken,
        userId: config.userId,
        deviceId: config.deviceId,
        timelineSupport: true,
        useAuthorizationHeader: true,
        pendingEventOrdering: PendingEventOrdering.Detached,
        store,
        scheduler,
    });
}
