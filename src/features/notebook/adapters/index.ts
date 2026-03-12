import type { NotebookAdapter } from "./types";
import { httpNotebookAdapter } from "./httpNotebookAdapter";
import { mockNotebookAdapter } from "./mockNotebookAdapter";
import { notebookAdapterMode } from "../adapterMode";

export function getNotebookAdapter(): NotebookAdapter {
    if (notebookAdapterMode === "http") {
        return httpNotebookAdapter;
    }
    return mockNotebookAdapter;
}
