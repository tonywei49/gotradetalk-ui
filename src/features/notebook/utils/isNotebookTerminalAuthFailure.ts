import { NotebookApiError } from "../adapters/types.ts";

export const NOTEBOOK_TERMINAL_AUTH_FAILURE_CODES = [
    "NO_VALID_HUB_TOKEN",
    "INVALID_AUTH_TOKEN",
    "INVALID_TOKEN_TYPE",
] as const;

export type NotebookTerminalAuthFailureCode = typeof NOTEBOOK_TERMINAL_AUTH_FAILURE_CODES[number];

export type NotebookTerminalAuthFailureSignal = {
    code?: string | null;
    status?: number | null;
    terminal?: boolean;
};

function isNotebookTerminalAuthFailureCodeValue(code: string | null | undefined): code is NotebookTerminalAuthFailureCode {
    return typeof code === "string" && (NOTEBOOK_TERMINAL_AUTH_FAILURE_CODES as readonly string[]).includes(code);
}

function isExplicitTerminalSignal(signal: NotebookTerminalAuthFailureSignal): boolean {
    return signal.terminal === true;
}

export function isNotebookTerminalAuthFailureCode(code: string | null | undefined): code is NotebookTerminalAuthFailureCode {
    return isNotebookTerminalAuthFailureCodeValue(code);
}

export function isNotebookTerminalAuthFailureSignal(signal: NotebookTerminalAuthFailureSignal | null | undefined): boolean {
    if (!signal) return false;
    if (isNotebookTerminalAuthFailureCodeValue(signal.code)) return true;
    if (!isExplicitTerminalSignal(signal)) return false;
    return signal.status === 401;
}

export function isNotebookTerminalAuthFailure(input: unknown): boolean {
    if (typeof input === "string") {
        return isNotebookTerminalAuthFailureCodeValue(input);
    }

    if (input instanceof NotebookApiError) {
        return isNotebookTerminalAuthFailureSignal({
            code: input.code,
            status: input.status,
        });
    }

    if (!input || typeof input !== "object") return false;

    const maybeSignal = input as {
        code?: unknown;
        status?: unknown;
        terminal?: unknown;
    };

    return isNotebookTerminalAuthFailureSignal({
        code: typeof maybeSignal.code === "string" ? maybeSignal.code : null,
        status: typeof maybeSignal.status === "number" ? maybeSignal.status : null,
        terminal: maybeSignal.terminal === true,
    });
}
