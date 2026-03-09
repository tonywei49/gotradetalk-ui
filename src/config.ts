const ensureEnv = (value: string | undefined, key: string): string => {
    if (!value) {
        throw new Error(`Missing ${key}`);
    }
    return value;
};

const isAbsoluteUrl = (value: string | undefined): boolean => Boolean(value && /^https?:\/\//i.test(value));

const configuredHubBaseUrl = import.meta.env.VITE_HUB_API_BASE_URL as string | undefined;
const configuredNotebookBaseUrl = import.meta.env.VITE_NOTEBOOK_API_BASE_URL as string | undefined;
const defaultHubBaseUrl = "https://api.gotradetalk.com";

export const hubApiBaseUrl = ensureEnv(
    import.meta.env.MODE === "development" && isAbsoluteUrl(configuredHubBaseUrl)
        ? "/api"
        : configuredHubBaseUrl ?? (import.meta.env.MODE === "development" ? "/api" : defaultHubBaseUrl),
    "VITE_HUB_API_BASE_URL",
);

export const notebookApiBaseUrl =
    import.meta.env.MODE === "development" && isAbsoluteUrl(configuredNotebookBaseUrl)
        ? "/notebook-api"
        : configuredNotebookBaseUrl ?? (import.meta.env.MODE === "development" ? "/notebook-api" : hubApiBaseUrl);

export const defaultPublicHs =
    (import.meta.env.VITE_DEFAULT_PUBLIC_HS as string | undefined) ?? "https://matrix.gotradetalk.com";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const voiceCaptureEnabled = import.meta.env.VITE_ENABLE_VOICE_CAPTURE === "true";
