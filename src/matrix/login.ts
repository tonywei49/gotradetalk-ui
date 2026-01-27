import { createClient } from "matrix-js-sdk";

type ServerConfig = {
    hsUrl: string;
};

export type MatrixLoginCredentials = {
    userId: string;
    accessToken: string;
    deviceId: string;
    homeserverUrl: string;
};

async function validateServerConfigWithStaticUrls(hsUrl: string): Promise<ServerConfig> {
    return { hsUrl };
}

export async function loginWithPassword(
    hsUrl: string,
    username: string,
    password: string,
): Promise<MatrixLoginCredentials> {
    const serverConfig = await validateServerConfigWithStaticUrls(hsUrl);
    const client = createClient({
        baseUrl: serverConfig.hsUrl,
    });

    const response = await client.login("m.login.password", {
        user: username,
        password,
    });

    return {
        userId: response.user_id,
        accessToken: response.access_token,
        deviceId: response.device_id,
        homeserverUrl: serverConfig.hsUrl,
    };
}
