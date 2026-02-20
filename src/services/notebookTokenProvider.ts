import type { HubSupabaseSession } from "../api/types";

export type NotebookTokenResolution = {
    accessToken: string | null;
    reason: "ok" | "missing_hub_token" | "expired_hub_token" | "invalid_hub_token_format";
};

function isLikelyJwtToken(token: string): boolean {
    const trimmed = token.trim();
    if (!trimmed.startsWith("eyJ")) return false;
    const parts = trimmed.split(".");
    if (parts.length !== 3) return false;
    return parts.every((part) => part.length > 0);
}

export function resolveNotebookAccessToken(hubSession: HubSupabaseSession | null): NotebookTokenResolution {
    if (!hubSession?.access_token) {
        return { accessToken: null, reason: "missing_hub_token" };
    }

    if (hubSession.expires_at && (hubSession.expires_at * 1000) <= Date.now()) {
        return { accessToken: null, reason: "expired_hub_token" };
    }

    if (!isLikelyJwtToken(hubSession.access_token)) {
        return { accessToken: null, reason: "invalid_hub_token_format" };
    }

    return {
        accessToken: hubSession.access_token,
        reason: "ok",
    };
}
