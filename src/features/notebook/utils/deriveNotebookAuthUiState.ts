export type NotebookAuthPhase = "bootstrapping" | "ready" | "hard-auth-failed";

export type NotebookErrorPolicy = "none" | "retryable-service-error" | "relogin-required";

export type NotebookTokenReason =
    | "ok"
    | "missing_hub_token"
    | "expired_hub_token"
    | "invalid_hub_token_format";

export type NotebookTerminalAuthErrorCode =
    | "NO_VALID_HUB_TOKEN"
    | "INVALID_AUTH_TOKEN"
    | "INVALID_TOKEN_TYPE"
    | "HTTP_401";

export type NotebookAuthUiStateInput = {
    userType: "client" | "staff" | null;
    notebookTokenReason: NotebookTokenReason;
    hasRefreshToken: boolean;
    refreshingNotebookToken: boolean;
    hubMeResolved: boolean;
    hasResolvedNotebookApiBaseUrl: boolean;
    capabilityLoaded: boolean;
    terminalAuthErrorCode: NotebookTerminalAuthErrorCode | null;
    retryableServiceError?: boolean;
};

export type NotebookAuthUiState = {
    notebookAuthPhase: NotebookAuthPhase;
    notebookErrorPolicy: NotebookErrorPolicy;
};

function isTerminalAuthTokenReason(reason: NotebookTokenReason): boolean {
    return reason === "missing_hub_token"
        || reason === "expired_hub_token"
        || reason === "invalid_hub_token_format";
}

function hasNotebookBootstrapBlockingCondition(input: NotebookAuthUiStateInput): boolean {
    if (input.refreshingNotebookToken) return true;
    if (input.userType === "staff" && !input.hubMeResolved) return true;
    if (input.userType === "staff" && input.hubMeResolved && !input.hasResolvedNotebookApiBaseUrl) return true;
    if (!input.capabilityLoaded) return true;
    return false;
}

function hasRecoverableTokenPath(input: NotebookAuthUiStateInput): boolean {
    return input.hasRefreshToken || input.notebookTokenReason === "ok";
}

export function deriveNotebookAuthUiState(input: NotebookAuthUiStateInput): NotebookAuthUiState {
    if (input.terminalAuthErrorCode) {
        return {
            notebookAuthPhase: "hard-auth-failed",
            notebookErrorPolicy: "relogin-required",
        };
    }

    if (isTerminalAuthTokenReason(input.notebookTokenReason) && !hasRecoverableTokenPath(input)) {
        return {
            notebookAuthPhase: "hard-auth-failed",
            notebookErrorPolicy: "relogin-required",
        };
    }

    if (input.notebookTokenReason !== "ok" && (input.hasRefreshToken || input.refreshingNotebookToken)) {
        return {
            notebookAuthPhase: "bootstrapping",
            notebookErrorPolicy: "none",
        };
    }

    if (hasNotebookBootstrapBlockingCondition(input)) {
        return {
            notebookAuthPhase: "bootstrapping",
            notebookErrorPolicy: "none",
        };
    }

    if (input.retryableServiceError) {
        return {
            notebookAuthPhase: "ready",
            notebookErrorPolicy: "retryable-service-error",
        };
    }

    return {
        notebookAuthPhase: "ready",
        notebookErrorPolicy: "none",
    };
}
