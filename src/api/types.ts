export type HubMatrixCredentials = {
    access_token: string;
    device_id: string;
    user_id: string;
    hs_url: string;
};

export type HubSupabaseSession = {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
};

export type HubClientLoginResponse = {
    matrix: HubMatrixCredentials;
    supabase?: HubSupabaseSession;
};

export type HubClientSessionMetadata = {
    session_slot: "computer" | "mobile";
    platform: "web" | "windows" | "macos" | "linux" | "ios" | "android" | "unknown";
    app_variant: "web" | "tauri";
    device_name: string;
    device_fingerprint: string;
};

export type HubStaffSessionExchangeResponse = {
    supabase?: HubSupabaseSession;
};

export type HubClientSignupPayload = {
    user_local_id: string;
    company_name: string;
    country: string;
    translation_locale: string;
    password: string;
    display_name?: string;
    gender?: string;
    job_title?: string;
};

export type HubProfileSummary = {
    id: string;
    display_name: string | null;
    company_name: string | null;
    job_title: string | null;
    country: string | null;
    user_local_id: string | null;
    matrix_user_id: string | null;
    user_type: string | null;
    locale?: string | null;
    translation_locale?: string | null;
};

export type HubMeResponse = {
    user_id: string;
    is_employee: boolean;
    memberships: Array<{ company_id: string; role: string }>;
    employee_persons: Array<{ company_id: string; person_id: string }>;
    profile: HubProfileSummary | null;
    company_id?: string | null;
    notebook_api_base_url?: string | null;
};

export type HubCapabilitiesResponse = {
    capabilities?: string[];
};
