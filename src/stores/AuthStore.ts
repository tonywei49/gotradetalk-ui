import type { MatrixClient } from "matrix-js-sdk";
import { create } from "zustand";

import type { HubMatrixCredentials, HubSupabaseSession } from "../api/types";
import { createMatrixClient } from "../matrix/client";

export type AuthUserType = "client" | "staff";

type PersistedAuthState = {
    userType: AuthUserType;
    matrixCredentials: HubMatrixCredentials;
    hubSession: HubSupabaseSession | null;
    persistedAt: number;
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
    validateSession: () => Promise<void>;
    clearSession: () => void;
};

const STORAGE_KEY = "gt_auth_session";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24;

function loadPersistedState(): PersistedAuthState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedAuthState;
        if (!parsed.persistedAt) {
            parsed.persistedAt = Date.now();
        }
        return parsed;
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

async function validateMatrixSession(credentials: HubMatrixCredentials): Promise<boolean> {
    try {
        const url = new URL("/_matrix/client/v3/account/whoami", credentials.hs_url);
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                Authorization: `Bearer ${credentials.access_token}`,
            },
        });
        return response.ok;
    } catch {
        return false;
    }
}

export const useAuthStore = create<AuthState>((set, get) => ({
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
            persistedAt: Date.now(),
        });
        set({
            userType,
            matrixCredentials,
            hubSession,
            matrixClient,
        });
    },
    validateSession: async () => {
        const state = get();
        if (!state.matrixCredentials) return;
        const persisted = loadPersistedState();
        if (!persisted) {
            get().clearSession();
            return;
        }
        const nowSec = Date.now() / 1000;
        const hubExpiry = persisted.hubSession?.expires_at;
        const expiresAtMs = hubExpiry ? hubExpiry * 1000 : persisted.persistedAt + DEFAULT_TTL_MS;
        if (expiresAtMs <= Date.now()) {
            get().clearSession();
            return;
        }
        const ok = await validateMatrixSession(persisted.matrixCredentials);
        if (!ok) {
            get().clearSession();
        }
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
