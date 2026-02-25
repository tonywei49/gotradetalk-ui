import type { NotebookCapability } from "./types";

export type NotebookCapabilityState = {
    loading: boolean;
    loaded: boolean;
    values: NotebookCapability[];
    canUseNotebookBasic: boolean;
    canUseNotebookAssist: boolean;
};

export function resolveNotebookCapabilities(params: {
    userType: "client" | "staff" | null;
    capabilities: string[];
    loaded: boolean;
}): NotebookCapabilityState {
    const set = new Set(params.capabilities);
    const canUseNotebookAssist = set.has("NOTEBOOK_LLM_ASSIST");
    const canUseNotebookBasic = set.has("NOTEBOOK_BASIC");

    return {
        loading: !params.loaded,
        loaded: params.loaded,
        values: Array.from(set) as NotebookCapability[],
        canUseNotebookBasic,
        canUseNotebookAssist,
    };
}
