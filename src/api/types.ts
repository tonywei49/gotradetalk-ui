export type HubMatrixCredentials = {
    access_token: string;
    device_id: string;
    user_id: string;
    hs_url: string;
};

export type HubClientLoginResponse = {
    matrix: HubMatrixCredentials;
    supabase?: {
        access_token: string;
        refresh_token: string;
        expires_at?: number;
    };
};

export type HubClientSignupPayload = {
    user_local_id: string;
    company_name: string;
    password: string;
    display_name?: string;
    gender?: string;
    job_title?: string;
};
