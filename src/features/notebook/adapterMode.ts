const configuredAdapterMode = (import.meta.env.VITE_NOTEBOOK_ADAPTER_MODE as string | undefined)?.trim().toLowerCase();

export type NotebookAdapterMode = "http" | "mock";

export const notebookAdapterMode: NotebookAdapterMode =
    configuredAdapterMode === "http" || configuredAdapterMode === "mock"
        ? configuredAdapterMode
        : import.meta.env.PROD
            ? "http"
            : "mock";
