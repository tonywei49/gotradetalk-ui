import type { MatrixClient } from "matrix-js-sdk";
import { create } from "zustand";

import type { HubMatrixCredentials, HubSupabaseSession } from "../api/types";
import { createMatrixClient } from "../matrix/client";

export type AuthUserType = "client" | "staff";

type AuthState = {
    userType: AuthUserType | null;
    matrixCredentials: HubMatrixCredentials | null;
    hubSession: HubSupabaseSession | null;
    matrixClient: MatrixClient | null;
    setSession: (params: {
        userType: AuthUserType;
        matrixCredentials: HubMatrixCredentials;
        hubSession: HubSupabaseSession | null;
    }) => void;
    clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
    userType: null,
    matrixCredentials: null,
    hubSession: null,
    matrixClient: null,
    setSession: ({ userType, matrixCredentials, hubSession }) => {
        const matrixClient = createMatrixClient({
            baseUrl: matrixCredentials.hs_url,
            accessToken: matrixCredentials.access_token,
            userId: matrixCredentials.user_id,
            deviceId: matrixCredentials.device_id,
        });
        set({
            userType,
            matrixCredentials,
            hubSession,
            matrixClient,
        });
    },
    clearSession: () => {
        set({
            userType: null,
            matrixCredentials: null,
            hubSession: null,
            matrixClient: null,
        });
    },
}));
