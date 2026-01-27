import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseAnonKey, supabaseUrl } from "../config";

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Missing Supabase configuration");
    }

    if (!cachedClient) {
        cachedClient = createClient(supabaseUrl, supabaseAnonKey);
    }

    return cachedClient;
}
