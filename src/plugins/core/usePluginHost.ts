import { useContext } from "react";
import { PluginHostContext } from "./PluginHostContext";
import type { PluginResolvedSlotItem, PluginSlot } from "../types";

export function usePluginHost() {
    const value = useContext(PluginHostContext);
    if (!value) {
        throw new Error("PluginHostProvider is missing");
    }
    return value;
}

export function usePluginSlot<K extends PluginSlot>(slot: K): Array<PluginResolvedSlotItem<K>> {
    return usePluginHost().getSlotItems(slot);
}
