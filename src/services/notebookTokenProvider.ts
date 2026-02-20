import type { HubSupabaseSession } from "../api/types";

export type NotebookTokenResolution = {
    accessToken: string | null;
    reason: "ok" | "missing_hub_token" | "expired_hub_token";
};

export function resolveNotebookAccessToken(hubSession: HubSupabaseSession | null): NotebookTokenResolution {
    if (!hubSession?.access_token) {
        return { accessToken: null, reason: "missing_hub_token" };
    }

    if (hubSession.expires_at && (hubSession.expires_at * 1000) <= Date.now()) {
        return { accessToken: null, reason: "expired_hub_token" };
    }

    return {
        accessToken: hubSession.access_token,
        reason: "ok",
    };
}
