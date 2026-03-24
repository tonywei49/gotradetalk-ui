import assert from "node:assert/strict";
import test from "node:test";

import {
    deriveNotebookAuthUiState,
} from "./deriveNotebookAuthUiState.ts";

test("keeps notebook in bootstrap while a refresh token exists and notebook token is temporarily missing", () => {
    const state = deriveNotebookAuthUiState({
        userType: "staff",
        notebookTokenReason: "missing_hub_token",
        hasRefreshToken: true,
        refreshingNotebookToken: false,
        hubMeResolved: false,
        hasResolvedNotebookApiBaseUrl: false,
        capabilityLoaded: false,
        terminalAuthErrorCode: null,
    });

    assert.equal(state.notebookAuthPhase, "bootstrapping");
    assert.equal(state.notebookErrorPolicy, "none");
});

test("keeps staff notebook in bootstrap until /me and company base url resolve", () => {
    const state = deriveNotebookAuthUiState({
        userType: "staff",
        notebookTokenReason: "ok",
        hasRefreshToken: true,
        refreshingNotebookToken: false,
        hubMeResolved: false,
        hasResolvedNotebookApiBaseUrl: false,
        capabilityLoaded: true,
        terminalAuthErrorCode: null,
    });

    assert.equal(state.notebookAuthPhase, "bootstrapping");
    assert.equal(state.notebookErrorPolicy, "none");
});

test("becomes hard-auth-failed when notebook auth is terminally invalid and no recovery path exists", () => {
    const state = deriveNotebookAuthUiState({
        userType: "staff",
        notebookTokenReason: "invalid_hub_token_format",
        hasRefreshToken: false,
        refreshingNotebookToken: false,
        hubMeResolved: true,
        hasResolvedNotebookApiBaseUrl: true,
        capabilityLoaded: true,
        terminalAuthErrorCode: "INVALID_AUTH_TOKEN",
    });

    assert.equal(state.notebookAuthPhase, "hard-auth-failed");
    assert.equal(state.notebookErrorPolicy, "relogin-required");
});

test("keeps ready state while surfacing a retryable service failure", () => {
    const state = deriveNotebookAuthUiState({
        userType: "client",
        notebookTokenReason: "ok",
        hasRefreshToken: true,
        refreshingNotebookToken: false,
        hubMeResolved: true,
        hasResolvedNotebookApiBaseUrl: true,
        capabilityLoaded: true,
        terminalAuthErrorCode: null,
        retryableServiceError: true,
    });

    assert.equal(state.notebookAuthPhase, "ready");
    assert.equal(state.notebookErrorPolicy, "retryable-service-error");
});
