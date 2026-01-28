import { createClient, type MatrixClient } from "matrix-js-sdk";

type MatrixClientConfig = {
    baseUrl: string;
    accessToken: string;
    userId: string;
    deviceId?: string;
};

export function createMatrixClient(config: MatrixClientConfig): MatrixClient {
    return createClient({
        baseUrl: config.baseUrl,
        accessToken: config.accessToken,
        userId: config.userId,
        deviceId: config.deviceId,
        timelineSupport: true,
        useAuthorizationHeader: true,
    });
}
