import { fetchWithDesktopSupport, isTauriDesktop, setNativeFetch } from "./fetchWithDesktopSupport";

const FETCH_BRIDGE_FLAG = "__gttDesktopHttpBridgeInstalled";

export function installDesktopHttpBridge(): void {
    if (!isTauriDesktop()) return;

    const globalScope = window as Window & typeof globalThis & {
        [FETCH_BRIDGE_FLAG]?: boolean;
    };

    if (globalScope[FETCH_BRIDGE_FLAG]) return;

    setNativeFetch(globalScope.fetch.bind(globalScope));

    globalScope.fetch = ((input: URL | Request | string, init?: RequestInit) => {
        return fetchWithDesktopSupport(input, init);
    }) as typeof fetch;

    globalScope[FETCH_BRIDGE_FLAG] = true;
}
