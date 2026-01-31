import type { HubSupabaseSession } from "./types";
import {
    hubStaffLocaleSelf,
    hubStaffTranslationLocaleSelf,
    hubStaffUpdateLocaleSelf,
    hubStaffUpdateTranslationLocaleSelf,
} from "./hub";
import { getSupabaseClient } from "./supabase";

async function ensureSupabaseSession(session: HubSupabaseSession): Promise<string> {
    const supabase = getSupabaseClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
    });
    if (sessionError) {
        throw new Error(sessionError.message);
    }
    const userId = sessionData.session?.user?.id;
    if (!userId) {
        throw new Error("Missing Supabase user");
    }
    return userId;
}

export async function fetchClientLanguage(session: HubSupabaseSession): Promise<string | null> {
    const supabase = getSupabaseClient();
    const userId = await ensureSupabaseSession(session);
    const { data, error } = await supabase
        .from("profiles")
        .select("locale")
        .eq("auth_user_id", userId)
        .eq("user_type", "client")
        .maybeSingle();
    if (error) {
        throw new Error(error.message);
    }
    return data?.locale ?? null;
}

export async function updateClientLanguage(session: HubSupabaseSession, language: string): Promise<void> {
    const supabase = getSupabaseClient();
    const userId = await ensureSupabaseSession(session);
    const { error } = await supabase
        .from("profiles")
        .update({ locale: language })
        .eq("auth_user_id", userId)
        .eq("user_type", "client");
    if (error) {
        throw new Error(error.message);
    }
}

export async function fetchClientTranslationLanguage(session: HubSupabaseSession): Promise<string | null> {
    const supabase = getSupabaseClient();
    const userId = await ensureSupabaseSession(session);
    const { data, error } = await supabase
        .from("profiles")
        .select("translation_locale")
        .eq("auth_user_id", userId)
        .eq("user_type", "client")
        .maybeSingle();
    if (error) {
        throw new Error(error.message);
    }
    return (data as { translation_locale?: string | null } | null)?.translation_locale ?? null;
}

export async function updateClientTranslationLanguage(session: HubSupabaseSession, language: string): Promise<void> {
    const supabase = getSupabaseClient();
    const userId = await ensureSupabaseSession(session);
    const { error } = await supabase
        .from("profiles")
        .update({ translation_locale: language })
        .eq("auth_user_id", userId)
        .eq("user_type", "client");
    if (error) {
        throw new Error(error.message);
    }
}

export async function fetchStaffLanguage(accessToken: string, hsUrl: string): Promise<string | null> {
    const response = await hubStaffLocaleSelf(accessToken, hsUrl);
    return response.locale ?? null;
}

export async function updateStaffLanguage(accessToken: string, hsUrl: string, language: string): Promise<void> {
    await hubStaffUpdateLocaleSelf(accessToken, hsUrl, language);
}

export async function fetchStaffTranslationLanguage(accessToken: string, hsUrl: string): Promise<string | null> {
    const response = await hubStaffTranslationLocaleSelf(accessToken, hsUrl);
    return response.translation_locale ?? null;
}

export async function updateStaffTranslationLanguage(accessToken: string, hsUrl: string, language: string): Promise<void> {
    await hubStaffUpdateTranslationLocaleSelf(accessToken, hsUrl, language);
}
