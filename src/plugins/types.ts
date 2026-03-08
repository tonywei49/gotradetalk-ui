import type { ReactNode } from "react";

export type PluginType = "internal" | "external";

export type PluginSlot =
    | "appNav"
    | "chatComposerToolbar"
    | "chatMessageActions"
    | "notebookTools"
    | "settingsSections";

export type PluginIconKey = "puzzle" | "sparkles" | "commandLine" | "book" | "folder" | "cog";

export type PluginRuntimeContext = {
    userType: "client" | "staff" | null;
    matrixUserId: string | null;
    matrixUserLocalId: string | null;
    matrixHomeServer: string | null;
    hasHubSession: boolean;
    platformManaged: boolean;
};

export type PluginPlatformState = {
    source: "default" | "platform";
    syncState: "idle" | "loading" | "ready" | "error";
    errorMessage: string | null;
};

export type PluginHostTools = {
    getPluginConfig: (pluginId: string) => Promise<Record<string, unknown> | null>;
    issuePluginToken: (pluginId: string, scope?: string[]) => Promise<{
        token: string;
        expiresAt: string | null;
        scope: string[];
    }>;
    reportPluginUsage: (
        pluginId: string,
        input: {
            action: string;
            status: "success" | "failed";
            requestId: string;
            meta?: Record<string, unknown>;
        },
    ) => Promise<{ message: string; quotaUsed: number | null }>;
};

export type PluginNavItem = {
    id: string;
    label: string;
    icon?: PluginIconKey;
    order?: number;
    badgeCount?: number;
    onSelect?: (context: PluginRuntimeContext) => void;
};

export type PluginComposerAction = {
    id: string;
    label: string;
    order?: number;
};

export type PluginMessageAction = {
    id: string;
    label: string;
    order?: number;
};

export type PluginNotebookTool = {
    id: string;
    label: string;
    order?: number;
};

export type PluginSettingsSection = {
    id: string;
    label: string;
    description?: string;
    order?: number;
    render?: (context: PluginRuntimeContext, platformState: PluginPlatformState, tools: PluginHostTools) => ReactNode;
};

export type PluginSlotMap = {
    appNav: PluginNavItem;
    chatComposerToolbar: PluginComposerAction;
    chatMessageActions: PluginMessageAction;
    notebookTools: PluginNotebookTool;
    settingsSections: PluginSettingsSection;
};

export type PluginDefinition = {
    id: string;
    name: string;
    version: string;
    type: PluginType;
    defaultEnabled?: boolean;
    isAvailable?: (context: PluginRuntimeContext) => boolean;
    slots?: {
        [K in PluginSlot]?: Array<PluginSlotMap[K]>;
    };
};

export type PluginResolvedSlotItem<K extends PluginSlot> = PluginSlotMap[K] & {
    pluginId: string;
    pluginName: string;
};
