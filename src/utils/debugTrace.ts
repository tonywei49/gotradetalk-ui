type TracePayload = Record<string, unknown>;

const FLAG_KEY = "gtt_debug_events";

export function isDebugTraceEnabled(): boolean {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(FLAG_KEY) === "1";
}

export function traceEvent(name: string, payload: TracePayload = {}): void {
    if (!isDebugTraceEnabled()) return;
    const ts = new Date().toISOString();
    // Unified trace output for invite/remove/sync diagnostics.
    console.log(`[gtt-trace] ${name}`, { ts, ...payload });
}

