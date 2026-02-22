export { getNotebookAdapter } from "./adapters";
export { NotebookSidebar } from "./components/NotebookSidebar";
export { NotebookPanel } from "./components/NotebookPanel";
export { useNotebookModule } from "./useNotebookModule";
export { resolveNotebookCapabilities, type NotebookCapabilityState } from "./capabilities";
export { mapNotebookErrorToMessage } from "./notebookErrorMap";
export { buildNotebookAuth } from "./utils/buildNotebookAuth";
export type { NotebookAuthContext, NotebookAssistResponse, NotebookCapability, NotebookItem } from "./types";
export { NotebookApiError } from "./adapters/types";
