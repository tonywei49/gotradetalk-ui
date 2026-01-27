const ensureEnv = (value: string | undefined, key: string): string => {
    if (!value) {
        throw new Error(`Missing ${key}`);
    }
    return value;
};

const configuredHubBaseUrl = import.meta.env.VITE_HUB_API_BASE_URL as string | undefined;
const defaultHubBaseUrl =
    import.meta.env.MODE === "development" ? "/api" : "https://api.gotradetalk.com";

export const hubApiBaseUrl = ensureEnv(configuredHubBaseUrl ?? defaultHubBaseUrl, "VITE_HUB_API_BASE_URL");

export const defaultPublicHs =
    (import.meta.env.VITE_DEFAULT_PUBLIC_HS as string | undefined) ?? "https://matrix.gotradetalk.com";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
