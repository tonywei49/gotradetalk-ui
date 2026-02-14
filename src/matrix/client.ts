import { MatrixClient, MatrixScheduler, MemoryStore } from "matrix-js-sdk";
import { logger as matrixLogger } from "matrix-js-sdk/lib/logger";

type MatrixClientConfig = {
    baseUrl: string;
    accessToken: string;
    userId: string;
    deviceId?: string;
};

export function createMatrixClient(config: MatrixClientConfig): MatrixClient {
    // Force SDK logs to warn+ to avoid noisy sync payload output in production browsers.
    (matrixLogger as unknown as { setLevel?: (level: string, persist?: boolean) => void }).setLevel?.("warn", false);
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
        store,
        scheduler,
    });
}
