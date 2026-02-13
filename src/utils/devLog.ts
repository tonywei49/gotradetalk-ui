export function devLog(message: string, payload?: unknown): void {
    if (!import.meta.env.DEV) return;
    if (typeof payload === "undefined") {
        console.log(message);
        return;
    }
    console.log(message, payload);
}
