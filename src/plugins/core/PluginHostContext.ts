import { createContext } from "react";
import type {
    PluginDefinition,
    PluginHostTools,
    PluginPlatformState,
    PluginResolvedSlotItem,
    PluginRuntimeContext,
    PluginSlot,
} from "../types";

export type PluginHostValue = {
    plugins: PluginDefinition[];
    runtimeContext: PluginRuntimeContext;
    platformState: PluginPlatformState;
    tools: PluginHostTools;
    getSlotItems: <K extends PluginSlot>(slot: K) => Array<PluginResolvedSlotItem<K>>;
};

export const PluginHostContext = createContext<PluginHostValue | null>(null);
