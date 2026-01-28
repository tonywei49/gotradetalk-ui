import type { MatrixClient } from "matrix-js-sdk";
import { create } from "zustand";

import type { HubMatrixCredentials, HubSupabaseSession } from "../api/types";
import { createMatrixClient } from "../matrix/client";

export type AuthUserType = "client" | "staff";

type PersistedAuthState = {
    userType: AuthUserType;
    matrixCredentials: HubMatrixCredentials;
    hubSession: HubSupabaseSession | null;
};

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

const STORAGE_KEY = "gt_auth_session";

function loadPersistedState(): PersistedAuthState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as PersistedAuthState;
    } catch {
        return null;
    }
}

function persistState(state: PersistedAuthState | null): void {
    try {
        if (!state) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // ignore persistence failures
    }
}

export const useAuthStore = create<AuthState>((set) => ({
    userType: null,
    matrixCredentials: null,
    hubSession: null,
    matrixClient: null,
    ...((): Partial<AuthState> => {
        if (typeof window === "undefined") return {};
        const persisted = loadPersistedState();
        if (!persisted) return {};
        const matrixClient = createMatrixClient({
            baseUrl: persisted.matrixCredentials.hs_url,
            accessToken: persisted.matrixCredentials.access_token,
            userId: persisted.matrixCredentials.user_id,
            deviceId: persisted.matrixCredentials.device_id,
        });
        return {
            userType: persisted.userType,
            matrixCredentials: persisted.matrixCredentials,
            hubSession: persisted.hubSession,
            matrixClient,
        };
    })(),
    setSession: ({ userType, matrixCredentials, hubSession }) => {
        const matrixClient = createMatrixClient({
            baseUrl: matrixCredentials.hs_url,
            accessToken: matrixCredentials.access_token,
            userId: matrixCredentials.user_id,
            deviceId: matrixCredentials.device_id,
        });
        persistState({
            userType,
            matrixCredentials,
            hubSession,
        });
        set({
            userType,
            matrixCredentials,
            hubSession,
            matrixClient,
        });
    },
    clearSession: () => {
        persistState(null);
        set({
            userType: null,
            matrixCredentials: null,
            hubSession: null,
            matrixClient: null,
        });
    },
}));
