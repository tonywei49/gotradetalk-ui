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

type MatrixLoginResponse = {
    user_id: string;
    access_token: string;
    device_id?: string;
};

const MATRIX_LOGIN_TIMEOUT_MS = 12_000;

function buildMatrixLoginError(message: string, options?: {
    errcode?: string;
    httpStatus?: number;
}): Error & { errcode?: string; httpStatus?: number; statusCode?: number } {
    const error = new Error(message) as Error & {
        errcode?: string;
        httpStatus?: number;
        statusCode?: number;
    };
    if (options?.errcode) {
        error.errcode = options.errcode;
    }
    if (typeof options?.httpStatus === "number") {
        error.httpStatus = options.httpStatus;
        error.statusCode = options.httpStatus;
    }
    return error;
}

export async function loginWithPassword(
    hsUrl: string,
    username: string,
    password: string,
): Promise<MatrixLoginCredentials> {
    const serverConfig = await validateServerConfigWithStaticUrls(hsUrl);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
        controller.abort("MATRIX_LOGIN_TIMEOUT");
    }, MATRIX_LOGIN_TIMEOUT_MS);

    try {
        const response = await fetch(new URL("/_matrix/client/v3/login", serverConfig.hsUrl).toString(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "m.login.password",
                user: username,
                password,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            let message = `Matrix login failed (${response.status})`;
            let errcode = "";
            try {
                const data = (await response.json()) as { error?: string; message?: string; errcode?: string };
                if (typeof data.error === "string" && data.error.trim()) {
                    message = data.error.trim();
                } else if (typeof data.message === "string" && data.message.trim()) {
                    message = data.message.trim();
                }
                if (typeof data.errcode === "string" && data.errcode.trim()) {
                    errcode = data.errcode.trim();
                }
            } catch {
                const text = await response.text().catch(() => "");
                if (text.trim()) {
                    message = text.trim();
                }
            }
            throw buildMatrixLoginError(message, {
                errcode,
                httpStatus: response.status,
            });
        }

        const payload = (await response.json()) as MatrixLoginResponse;
        if (!payload.user_id || !payload.access_token) {
            throw buildMatrixLoginError("Matrix login response missing credentials");
        }

        return {
            userId: payload.user_id,
            accessToken: payload.access_token,
            deviceId: payload.device_id ?? "",
            homeserverUrl: serverConfig.hsUrl,
        };
    } catch (error) {
        if (
            error instanceof DOMException && error.name === "AbortError"
            || controller.signal.aborted
        ) {
            throw buildMatrixLoginError(`TIMEOUT: Matrix login request timed out after ${Math.floor(MATRIX_LOGIN_TIMEOUT_MS / 1000)}s`);
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}
