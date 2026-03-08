import type { PluginDefinition, PluginResolvedSlotItem, PluginRuntimeContext, PluginSlot, PluginSlotMap } from "../types";

export class PluginRegistry {
    private readonly pluginsById = new Map<string, PluginDefinition>();

    constructor(plugins: PluginDefinition[]) {
        for (const plugin of plugins) {
            this.pluginsById.set(plugin.id, plugin);
        }
    }

    list(): PluginDefinition[] {
        return Array.from(this.pluginsById.values());
    }

    getEnabledPlugins(context: PluginRuntimeContext, enabledPluginIds?: Set<string> | null): PluginDefinition[] {
        return this.list().filter((plugin) => {
            if (enabledPluginIds) {
                if (!enabledPluginIds.has(plugin.id)) return false;
            } else if (plugin.defaultEnabled === false) {
                return false;
            }
            return plugin.isAvailable ? plugin.isAvailable(context) : true;
        });
    }

    getSlotItems<K extends PluginSlot>(
        slot: K,
        context: PluginRuntimeContext,
        enabledPluginIds?: Set<string> | null,
    ): Array<PluginResolvedSlotItem<K>> {
        const items: Array<PluginResolvedSlotItem<K>> = [];

        for (const plugin of this.getEnabledPlugins(context, enabledPluginIds)) {
            const contributions = plugin.slots?.[slot] ?? [];
            for (const contribution of contributions) {
                items.push({
                    ...(contribution as PluginSlotMap[K]),
                    pluginId: plugin.id,
                    pluginName: plugin.name,
                });
            }
        }

        return items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
}
