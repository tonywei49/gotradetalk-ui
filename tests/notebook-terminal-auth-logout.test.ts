import test from "node:test";
import assert from "node:assert/strict";
import { NotebookApiError } from "../src/features/notebook/adapters/types.ts";
import {
    isNotebookTerminalAuthFailure,
    isNotebookTerminalAuthFailureCode,
    isNotebookTerminalAuthFailureSignal,
} from "../src/features/notebook/utils/isNotebookTerminalAuthFailure.ts";

test("classifies terminal notebook auth failure codes", () => {
    assert.equal(isNotebookTerminalAuthFailureCode("NO_VALID_HUB_TOKEN"), true);
    assert.equal(isNotebookTerminalAuthFailureCode("INVALID_AUTH_TOKEN"), true);
    assert.equal(isNotebookTerminalAuthFailureCode("INVALID_TOKEN_TYPE"), true);
});

test("classifies terminal notebook api errors", () => {
    assert.equal(
        isNotebookTerminalAuthFailure(new NotebookApiError("missing hub token", 403, "NO_VALID_HUB_TOKEN")),
        true,
    );
    assert.equal(
        isNotebookTerminalAuthFailure(new NotebookApiError("invalid auth token", 401, "INVALID_AUTH_TOKEN")),
        true,
    );
    assert.equal(
        isNotebookTerminalAuthFailure(new NotebookApiError("invalid token type", 401, "INVALID_TOKEN_TYPE")),
        true,
    );
});

test("does not classify retryable or generic notebook api errors as terminal", () => {
    assert.equal(isNotebookTerminalAuthFailure(new NotebookApiError("timed out", 408, "TIMEOUT")), false);
    assert.equal(isNotebookTerminalAuthFailure(new NotebookApiError("server busy", 503, "UNKNOWN")), false);
    assert.equal(isNotebookTerminalAuthFailure(new NotebookApiError("unexpected", 401, "UNAUTHORIZED")), false);
});

test("requires an explicit terminal signal for 401 status", () => {
    assert.equal(
        isNotebookTerminalAuthFailureSignal({ code: "UNAUTHORIZED", status: 401, terminal: true }),
        true,
    );
    assert.equal(
        isNotebookTerminalAuthFailureSignal({ code: "UNAUTHORIZED", status: 401, terminal: false }),
        false,
    );
    assert.equal(
        isNotebookTerminalAuthFailureSignal({ code: "UNAUTHORIZED", status: 401 }),
        false,
    );
});

test("accepts explicit terminal main-layout style inputs", () => {
    assert.equal(
        isNotebookTerminalAuthFailureSignal({ code: "INVALID_AUTH_TOKEN", status: 401, terminal: true }),
        true,
    );
    assert.equal(isNotebookTerminalAuthFailureSignal({ code: "INVALID_AUTH_TOKEN", status: 401 }), true);
});
