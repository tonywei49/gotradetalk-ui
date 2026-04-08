import type { TFunction } from "i18next";

type NormalizedError = {
    code: string;
    errcode: string;
    statusCode: number | null;
    message: string;
    normalized: string;
};

function normalizeError(error: unknown): NormalizedError {
    const maybeObj = error as
        | { code?: string; errcode?: string; statusCode?: number; httpStatus?: number; message?: string; error?: string }
        | null;
    const code = typeof maybeObj?.code === "string" ? maybeObj.code : "";
    const errcode = typeof maybeObj?.errcode === "string" ? maybeObj.errcode : "";
    const statusCode =
        typeof maybeObj?.statusCode === "number"
            ? maybeObj.statusCode
            : typeof maybeObj?.httpStatus === "number"
                ? maybeObj.httpStatus
                : null;
    const message =
        typeof maybeObj?.message === "string"
            ? maybeObj.message
            : typeof maybeObj?.error === "string"
                ? maybeObj.error
                : error instanceof Error
                    ? error.message
                    : String(error ?? "");
    const normalized = `${code} ${errcode} ${message}`.toUpperCase();
    return { code, errcode, statusCode, message, normalized };
}

export function isInvalidCredentialError(error: unknown): boolean {
    const { normalized } = normalizeError(error);
    return (
        normalized.includes("INVALID LOGIN CREDENTIALS") ||
        normalized.includes("WRONG USERNAME OR PASSWORD") ||
        normalized.includes("INVALID_CREDENTIALS") ||
        normalized.includes("M_FORBIDDEN")
    );
}

export function mapActionErrorToMessage(
    t: TFunction,
    error: unknown,
    fallbackKey: string,
): string {
    const { code, errcode, statusCode, normalized, message } = normalizeError(error);
    if (normalized.includes("CAPABILITY_DISABLED")) {
        return t("layout.notebook.capabilityDisabled");
    }
    if (normalized.includes("CAPABILITY_EXPIRED")) {
        return t("layout.notebook.capabilityExpired");
    }
    if (normalized.includes("QUOTA_EXCEEDED")) {
        return t("layout.notebook.quotaExceeded");
    }
    if (normalized.includes("MANAGED_BY_PLATFORM")) {
        return t("layout.notebook.managedByPlatformHint");
    }
    if (
        normalized.includes("NO_VALID_HUB_TOKEN") ||
        normalized.includes("INVALID_AUTH_TOKEN") ||
        normalized.includes("INVALID_TOKEN_TYPE")
    ) {
        return t("layout.notebook.authFailed");
    }
    if (
        normalized.includes("M_LIMIT_EXCEEDED") ||
        normalized.includes("STORAGE_QUOTA_EXCEEDED") ||
        normalized.includes("QUOTA") ||
        normalized.includes("STORAGE") ||
        statusCode === 413
    ) {
        return t("common.errors.quotaExceeded");
    }
    if (
        normalized.includes("M_FORBIDDEN") ||
        normalized.includes("NO_PERMISSION") ||
        statusCode === 401 ||
        statusCode === 403
    ) {
        return t("common.errors.noPermission");
    }
    if (normalized.includes("TIMEOUT") || normalized.includes("ETIMEDOUT")) {
        return t("common.errors.timeout");
    }
    if (
        normalized.includes("FAILED TO FETCH") ||
        normalized.includes("NETWORKERROR") ||
        normalized.includes("CONNECTION") ||
        normalized.includes("ECONN")
    ) {
        return t("common.errors.network");
    }
    if (
        normalized.includes("FAILED TO PARSE LOGIC TREE") ||
        normalized.includes("PARSE LOGIC TREE")
    ) {
        return t("common.errors.invalidSearchQuery");
    }
    if (code || errcode || statusCode !== null) {
        return t(fallbackKey);
    }
    return message || t(fallbackKey);
}

export function mapAuthErrorToMessage(t: TFunction, error: unknown): string {
    const { statusCode, normalized, message } = normalizeError(error);
    if (isInvalidCredentialError(error)) return t("auth.errors.invalidCredentials");
    if (normalized.includes("ACCOUNT NOT FOUND")) {
        return t(
            "auth.errors.accountNotFound",
            "Account not found. If you registered with email but did not finish client setup, continue registration from the email link first.",
        );
    }
    if (
        statusCode === 429
        || normalized.includes("TOO MANY REQUESTS")
        || normalized.includes("OVER EMAIL SEND RATE LIMIT")
        || normalized.includes("RATE LIMIT")
    ) {
        const waitSeconds = message.match(/after\s+(\d+)\s+seconds?/i)?.[1];
        if (waitSeconds) {
            return t(
                "auth.errors.rateLimitedWait",
                { seconds: waitSeconds, defaultValue: "Too many attempts right now. Please wait {{seconds}} seconds and try again." },
            );
        }
        return t(
            "auth.errors.rateLimited",
            "Too many attempts right now. Please wait a moment and try again.",
        );
    }
    return mapActionErrorToMessage(t, error, "auth.errors.generic");
}
