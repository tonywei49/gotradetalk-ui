import type { PluginDefinition } from "../types";
import { PluginLabPanel } from "./PluginLabPanel";

export const pluginLabPlugin: PluginDefinition = {
    id: "plugin-lab",
    name: "Plugin Lab",
    version: "0.1.0",
    type: "internal",
    defaultEnabled: true,
    slots: {
        settingsSections: [
            {
                id: "overview",
                label: "Plugin Lab",
                description: "内建插件样板，用来验证平台化插件宿主骨架。",
                order: 100,
                render: (context, platformState, tools) => (
                    <PluginLabPanel context={context} platformState={platformState} tools={tools} />
                ),
            },
        ],
    },
};
