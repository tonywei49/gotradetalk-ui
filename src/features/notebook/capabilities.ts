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

    // Client 永遠隱藏 LLM 入口，即使服務端資料誤設。
    const canUseNotebookAssist = params.userType !== "client" && set.has("NOTEBOOK_LLM_ASSIST");

    // Notebook basic 在 V1 為核心能力，若後端尚未回傳 capability，預設可用。
    const canUseNotebookBasic = set.has("NOTEBOOK_BASIC") || !params.loaded;

    return {
        loading: !params.loaded,
        loaded: params.loaded,
        values: Array.from(set) as NotebookCapability[],
        canUseNotebookBasic,
        canUseNotebookAssist,
    };
}
