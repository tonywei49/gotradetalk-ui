import { createClient, type EmailOtpType, type Session, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseAnonKey, supabaseUrl } from "../config";

let cachedClient: SupabaseClient | null = null;

const EMAIL_OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

function sanitizeAuthCallbackUrl(currentUrl: URL): void {
    if (typeof window === "undefined") return;

    const sanitized = new URL(currentUrl.toString());
    sanitized.searchParams.delete("code");
    sanitized.searchParams.delete("token_hash");
    sanitized.searchParams.delete("type");
    sanitized.searchParams.delete("access_token");
    sanitized.searchParams.delete("refresh_token");
    sanitized.hash = "";

    const next = `${sanitized.pathname}${sanitized.search}${sanitized.hash}`;
    window.history.replaceState({}, document.title, next);
}

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

export async function resolveSupabaseSessionFromUrl(): Promise<Session | null> {
    const client = getSupabaseClient();
    const currentUrl = new URL(window.location.href);
    const hashParams = new URLSearchParams(currentUrl.hash.startsWith("#") ? currentUrl.hash.slice(1) : currentUrl.hash);
    const code = currentUrl.searchParams.get("code");
    const tokenHash = currentUrl.searchParams.get("token_hash");
    const otpType = currentUrl.searchParams.get("type");
    const accessToken = hashParams.get("access_token") ?? currentUrl.searchParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token") ?? currentUrl.searchParams.get("refresh_token");

    if (code) {
        const { data, error } = await client.auth.exchangeCodeForSession(code);
        if (error) {
            throw error;
        }
        sanitizeAuthCallbackUrl(currentUrl);
        return data.session ?? null;
    }

    if (tokenHash && otpType && EMAIL_OTP_TYPES.has(otpType)) {
        const { data, error } = await client.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType as EmailOtpType,
        });
        if (error) {
            throw error;
        }
        sanitizeAuthCallbackUrl(currentUrl);
        return data.session ?? null;
    }

    if (accessToken && refreshToken) {
        const { data, error } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });
        if (error) {
            throw error;
        }
        sanitizeAuthCallbackUrl(currentUrl);
        return data.session ?? null;
    }

    const { data, error } = await client.auth.getSession();
    if (error) {
        throw error;
    }
    return data.session ?? null;
}
