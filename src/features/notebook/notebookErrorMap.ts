import type { TFunction } from "i18next";
import { NotebookApiError } from "./adapters/types";

export function mapNotebookErrorToMessage(error: unknown, t: TFunction): string {
    if (error instanceof NotebookApiError) {
        if (error.code === "NO_VALID_HUB_TOKEN") {
            return t("chat.notebook.errors.noValidHubToken");
        }
        if (error.code === "INVALID_AUTH_TOKEN" || error.code === "UNAUTHORIZED" || error.code === "INVALID_TOKEN_TYPE") {
            return t("chat.notebook.errors.invalidAuth");
        }
        if (error.code === "FORBIDDEN_ROLE") {
            return t("chat.notebook.errors.forbiddenRole");
        }
        if (error.code === "CAPABILITY_DISABLED") {
            return t("chat.notebook.errors.capabilityDisabled");
        }
        if (error.code === "CAPABILITY_EXPIRED") {
            return t("chat.notebook.errors.capabilityExpired");
        }
        if (error.code === "QUOTA_EXCEEDED") {
            return t("chat.notebook.errors.quotaExceeded");
        }
        if (error.code === "INVALID_CONTEXT") {
            return t("chat.notebook.errors.invalidContext");
        }
        if (error.code === "MANAGED_BY_PLATFORM") {
            return t("chat.notebook.errors.managedByPlatform");
        }
        if (error.code === "TIMEOUT") {
            return t("chat.notebook.errors.timeout");
        }
        if (error.status >= 500) {
            return t("chat.notebook.errors.systemBusy");
        }
    }
    return error instanceof Error ? error.message : t("chat.notebook.errors.requestFailed");
}
