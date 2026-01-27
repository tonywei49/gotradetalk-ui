import type { HubSupabaseSession } from "./types";
import { getSupabaseClient } from "./supabase";

const STAFF_LOCALE_KEY_PREFIX = "gt_staff_locale_";

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

export function fetchStaffLanguageLocal(matrixUserId: string): string | null {
    if (!matrixUserId) return null;
    return localStorage.getItem(`${STAFF_LOCALE_KEY_PREFIX}${matrixUserId}`);
}

export function updateStaffLanguageLocal(matrixUserId: string, language: string): void {
    if (!matrixUserId) return;
    localStorage.setItem(`${STAFF_LOCALE_KEY_PREFIX}${matrixUserId}`, language);
}
