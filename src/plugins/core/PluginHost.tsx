import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "../../stores/AuthStore";
import type { PlatformMyPluginItem } from "../../api/plugins";
import {
    getPlatformMyPlugins,
    getPlatformPluginConfig,
    issuePlatformPluginToken,
    reportPlatformPluginUsage,
} from "../../api/plugins";
import { PluginRegistry } from "./registry";
import { getInternalPlugins } from "../internal";
import type { PluginHostTools, PluginPlatformState, PluginRuntimeContext } from "../types";
import { PluginHostContext, type PluginHostValue } from "./PluginHostContext";

function formatMatrixUserLocalId(matrixUserId: string | null | undefined): string | null {
    const raw = String(matrixUserId || "").trim();
    if (!raw) return null;
    const withoutPrefix = raw.startsWith("@") ? raw.slice(1) : raw;
    const colonIndex = withoutPrefix.indexOf(":");
    if (colonIndex <= 0) return withoutPrefix;
    return withoutPrefix.slice(0, colonIndex);
}

export function PluginHostProvider({ children }: { children: React.ReactNode }) {
    const userType = useAuthStore((state) => state.userType);
    const matrixCredentials = useAuthStore((state) => state.matrixCredentials);
    const hubSession = useAuthStore((state) => state.hubSession);
    const hubAccessToken = hubSession?.access_token ?? null;
    const matrixHsUrl = matrixCredentials?.hs_url ?? null;
    const matrixUserId = matrixCredentials?.user_id ?? null;
    const hasHubAccessToken = Boolean(hubAccessToken);
    const requestKey = useMemo(
        () => [hubAccessToken ?? "", matrixHsUrl ?? "", matrixUserId ?? ""].join("|"),
        [hubAccessToken, matrixHsUrl, matrixUserId],
    );
    const [platformSnapshot, setPlatformSnapshot] = useState<{
        requestKey: string | null;
        enabledPluginIds: Set<string> | null;
        platformItemsByCode: Map<string, PlatformMyPluginItem>;
        source: "default" | "platform";
        errorMessage: string | null;
    }>({
        requestKey: null,
        enabledPluginIds: null,
        platformItemsByCode: new Map(),
        source: "default",
        errorMessage: null,
    });

    const runtimeContext = useMemo<PluginRuntimeContext>(() => ({
        userType,
        matrixUserId,
        matrixUserLocalId: formatMatrixUserLocalId(matrixUserId),
        matrixHomeServer: matrixHsUrl,
        hasHubSession: Boolean(hubAccessToken),
        platformManaged: true,
    }), [hubAccessToken, matrixHsUrl, matrixUserId, userType]);

    const plugins = useMemo(() => getInternalPlugins(), []);
    const registry = useMemo(() => new PluginRegistry(plugins), [plugins]);

    useEffect(() => {
        let cancelled = false;

        if (!hasHubAccessToken || !hubAccessToken) {
            return;
        }

        void getPlatformMyPlugins({
            accessToken: hubAccessToken,
            hsUrl: matrixHsUrl,
            matrixUserId,
        })
            .then((response) => {
                if (cancelled) return;
                const items = response.items || [];
                const itemsByCode = new Map(items.map((item) => [item.code, item] as const));
                const nextIds = new Set(
                    items
                        .filter((item) => item.enabled)
                        .map((item) => item.code),
                );
                setPlatformSnapshot({
                    requestKey,
                    enabledPluginIds: nextIds,
                    platformItemsByCode: itemsByCode,
                    source: "platform",
                    errorMessage: null,
                });
            })
            .catch((error) => {
                if (cancelled) return;
                setPlatformSnapshot({
                    requestKey,
                    enabledPluginIds: null,
                    platformItemsByCode: new Map(),
                    source: "default",
                    errorMessage: error instanceof Error ? error.message : "Failed to sync plugins.",
                });
            });

        return () => {
            cancelled = true;
        };
    }, [hasHubAccessToken, hubAccessToken, matrixHsUrl, matrixUserId, requestKey]);

    const effectivePlatformState = useMemo<PluginPlatformState>(() => {
        if (!hasHubAccessToken) {
            return {
                source: "default",
                syncState: "idle",
                errorMessage: null,
            };
        }
        if (platformSnapshot.requestKey !== requestKey) {
            return {
                source: "default",
                syncState: "loading",
                errorMessage: null,
            };
        }
        if (platformSnapshot.errorMessage) {
            return {
                source: "default",
                syncState: "error",
                errorMessage: platformSnapshot.errorMessage,
            };
        }
        return {
            source: platformSnapshot.source,
            syncState: "ready",
            errorMessage: null,
        };
    }, [hasHubAccessToken, platformSnapshot, requestKey]);

    const effectiveEnabledPluginIds = useMemo(
        () => (hasHubAccessToken && platformSnapshot.requestKey === requestKey ? platformSnapshot.enabledPluginIds : null),
        [hasHubAccessToken, platformSnapshot, requestKey],
    );
    const effectivePlatformItemsByCode = useMemo(
        () => (hasHubAccessToken && platformSnapshot.requestKey === requestKey ? platformSnapshot.platformItemsByCode : new Map<string, PlatformMyPluginItem>()),
        [hasHubAccessToken, platformSnapshot, requestKey],
    );

    const getPluginConfig = useCallback<PluginHostTools["getPluginConfig"]>(async (pluginId) => {
        if (!hubAccessToken) {
            throw new Error("NO_VALID_HUB_TOKEN");
        }
        const resolvedPluginId = effectivePlatformItemsByCode.get(pluginId)?.plugin_id ?? pluginId;
        const response = await getPlatformPluginConfig({
            accessToken: hubAccessToken,
            pluginId: resolvedPluginId,
            hsUrl: matrixHsUrl,
            matrixUserId,
        });
        return response.config ?? null;
    }, [effectivePlatformItemsByCode, hubAccessToken, matrixHsUrl, matrixUserId]);

    const issuePluginToken = useCallback<PluginHostTools["issuePluginToken"]>(async (pluginId, scope) => {
        if (!hubAccessToken) {
            throw new Error("NO_VALID_HUB_TOKEN");
        }
        const resolvedPluginId = effectivePlatformItemsByCode.get(pluginId)?.plugin_id ?? pluginId;
        const response = await issuePlatformPluginToken({
            accessToken: hubAccessToken,
            pluginId: resolvedPluginId,
            scope,
            hsUrl: matrixHsUrl,
            matrixUserId,
        });
        return {
            token: response.token,
            expiresAt: response.expires_at ?? null,
            scope: response.scope ?? scope ?? [],
        };
    }, [effectivePlatformItemsByCode, hubAccessToken, matrixHsUrl, matrixUserId]);

    const reportPluginUsage = useCallback<PluginHostTools["reportPluginUsage"]>(async (pluginId, input) => {
        if (!hubAccessToken) {
            throw new Error("NO_VALID_HUB_TOKEN");
        }
        const resolvedPluginId = effectivePlatformItemsByCode.get(pluginId)?.plugin_id ?? pluginId;
        const response = await reportPlatformPluginUsage({
            accessToken: hubAccessToken,
            pluginId: resolvedPluginId,
            action: input.action,
            status: input.status,
            requestId: input.requestId,
            meta: input.meta,
            hsUrl: matrixHsUrl,
            matrixUserId,
        });
        return {
            message: response.message,
            quotaUsed: response.quota_used ?? null,
        };
    }, [effectivePlatformItemsByCode, hubAccessToken, matrixHsUrl, matrixUserId]);

    const tools = useMemo<PluginHostTools>(() => ({
        getPluginConfig,
        issuePluginToken,
        reportPluginUsage,
    }), [getPluginConfig, issuePluginToken, reportPluginUsage]);

    const value = useMemo<PluginHostValue>(() => ({
        plugins: registry.getEnabledPlugins(runtimeContext, effectiveEnabledPluginIds),
        runtimeContext,
        platformState: effectivePlatformState,
        tools,
        getSlotItems: (slot) => registry.getSlotItems(slot, runtimeContext, effectiveEnabledPluginIds),
    }), [effectiveEnabledPluginIds, effectivePlatformState, registry, runtimeContext, tools]);

    return <PluginHostContext.Provider value={value}>{children}</PluginHostContext.Provider>;
}
