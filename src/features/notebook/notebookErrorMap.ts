import type { TFunction } from "i18next";
import { NotebookApiError } from "./adapters/types";

export function mapNotebookErrorToMessage(error: unknown, t: TFunction): string {
    if (error instanceof NotebookApiError && (error.status === 401 || error.status === 403 || error.status === 422)) {
        if (error.code === "NO_VALID_HUB_TOKEN") {
            return t("chat.notebook.errors.noValidHubToken");
        }
        if (error.code === "INVALID_AUTH_TOKEN" || error.code === "UNAUTHORIZED") {
            return t("chat.notebook.errors.invalidAuth");
        }
        if (error.code === "FORBIDDEN_ROLE") {
            return t("chat.notebook.errors.forbiddenRole");
        }
        if (error.code === "CAPABILITY_DISABLED") {
            return t("chat.notebook.errors.capabilityDisabled");
        }
        if (error.code === "INVALID_CONTEXT") {
            return t("chat.notebook.errors.invalidContext");
        }
    }
    return error instanceof Error ? error.message : t("chat.notebook.errors.requestFailed");
}
