const ensureEnv = (value: string | undefined, key: string): string => {
    if (!value) {
        throw new Error(`Missing ${key}`);
    }
    return value;
};

export const hubApiBaseUrl = ensureEnv(
    import.meta.env.VITE_HUB_API_BASE_URL as string | undefined,
    "VITE_HUB_API_BASE_URL",
);

export const defaultPublicHs =
    (import.meta.env.VITE_DEFAULT_PUBLIC_HS as string | undefined) ?? "https://matrix.gotradetalk.com";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
