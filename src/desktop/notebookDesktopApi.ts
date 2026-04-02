import { invoke } from "@tauri-apps/api/core";

type DesktopNotebookCapabilitiesInput = {
    accessToken: string;
    apiBaseUrl: string;
    hsUrl?: string | null;
    matrixUserId?: string | null;
};

type DesktopNotebookCapabilitiesResult = {
    capabilities?: string[];
};

export async function desktopGetNotebookCapabilities(
    input: DesktopNotebookCapabilitiesInput,
): Promise<DesktopNotebookCapabilitiesResult> {
    return invoke<DesktopNotebookCapabilitiesResult>("desktop_notebook_get_capabilities", { input });
}
