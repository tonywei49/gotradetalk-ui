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
