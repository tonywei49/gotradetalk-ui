import { createClient, type IMatrixClientCreds } from "matrix-js-sdk";

type ServerConfig = {
    hsUrl: string;
};

async function validateServerConfigWithStaticUrls(hsUrl: string): Promise<ServerConfig> {
    return { hsUrl };
}

export async function loginWithPassword(
    hsUrl: string,
    username: string,
    password: string,
): Promise<IMatrixClientCreds> {
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
        identityServerUrl: undefined,
        guest: false,
        pickleKey: undefined,
        freshLogin: true,
    };
}
