import type { NotebookAdapter } from "./types";
import { httpNotebookAdapter } from "./httpNotebookAdapter";
import { mockNotebookAdapter } from "./mockNotebookAdapter";

const adapterMode = (import.meta.env.VITE_NOTEBOOK_ADAPTER_MODE as string | undefined)?.trim().toLowerCase();

export function getNotebookAdapter(): NotebookAdapter {
    if (adapterMode === "http") {
        return httpNotebookAdapter;
    }
    return mockNotebookAdapter;
}
