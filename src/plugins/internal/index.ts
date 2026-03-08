import type { PluginDefinition } from "../types";
import { pluginLabPlugin } from "./pluginLab";

export function getInternalPlugins(): PluginDefinition[] {
    return [pluginLabPlugin];
}
