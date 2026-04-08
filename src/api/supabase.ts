import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseAnonKey, supabaseUrl } from "../config";

let cachedClient: SupabaseClient | null = null;

export function hasSupabaseConfig(): boolean {
    return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getOptionalSupabaseClient(): SupabaseClient | null {
    if (!hasSupabaseConfig()) {
        return null;
    }

    if (!cachedClient) {
        cachedClient = createClient(supabaseUrl as string, supabaseAnonKey as string);
    }

    return cachedClient;
}

export function getSupabaseClient(): SupabaseClient {
    const client = getOptionalSupabaseClient();
    if (!client) {
        throw new Error("Missing Supabase configuration");
    }
    return client;
}
