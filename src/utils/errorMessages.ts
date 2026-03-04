import type { TFunction } from "i18next";

type NormalizedError = {
    errcode: string;
    statusCode: number | null;
    message: string;
    normalized: string;
};

function normalizeError(error: unknown): NormalizedError {
    const maybeObj = error as
        | { errcode?: string; statusCode?: number; httpStatus?: number; message?: string; error?: string }
        | null;
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
    const normalized = `${errcode} ${message}`.toUpperCase();
    return { errcode, statusCode, message, normalized };
}

export function isInvalidCredentialError(error: unknown): boolean {
    const { statusCode, normalized } = normalizeError(error);
    return (
        normalized.includes("INVALID LOGIN CREDENTIALS") ||
        normalized.includes("WRONG USERNAME OR PASSWORD") ||
        normalized.includes("ACCOUNT NOT FOUND") ||
        normalized.includes("INVALID_CREDENTIALS") ||
        normalized.includes("M_FORBIDDEN") ||
        statusCode === 401 ||
        statusCode === 403
    );
}

export function mapActionErrorToMessage(
    t: TFunction,
    error: unknown,
    fallbackKey: string,
): string {
    const { errcode, statusCode, normalized, message } = normalizeError(error);
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
    if (errcode || statusCode !== null) {
        return t(fallbackKey);
    }
    return message || t(fallbackKey);
}

export function mapAuthErrorToMessage(t: TFunction, error: unknown): string {
    if (isInvalidCredentialError(error)) return t("auth.errors.invalidCredentials");
    return mapActionErrorToMessage(t, error, "auth.errors.generic");
}
