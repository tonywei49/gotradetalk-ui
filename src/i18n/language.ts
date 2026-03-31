import i18n from "i18next";
import { isSupportedDisplayLanguage, type DisplayLanguage } from "../constants/displayLanguages";

const STORAGE_KEY = "gt_lang";
export const DEFAULT_LANGUAGE: DisplayLanguage = "en";

const languageLoaders: Partial<Record<DisplayLanguage, () => Promise<{ default: object }>>> = {
    ar: () => import("./ar.json"),
    es: () => import("./es.json"),
    fr: () => import("./fr.json"),
    id: () => import("./id.json"),
    it: () => import("./it.json"),
    ja: () => import("./ja.json"),
    pt: () => import("./pt.json"),
    ru: () => import("./ru.json"),
    vi: () => import("./vi.json"),
    "zh-CN": () => import("./zh-CN.json"),
    "zh-TW": () => import("./zh-TW.json"),
};

export function getStoredLanguage(): DisplayLanguage | null {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isSupportedDisplayLanguage(value) ? value : null;
}

export async function ensureLanguageResources(language: DisplayLanguage): Promise<void> {
    if (language === DEFAULT_LANGUAGE) return;
    if (i18n.hasResourceBundle(language, "translation")) return;

    const loader = languageLoaders[language];
    if (!loader) return;

    const module = await loader();
    const resources = module.default;
    if (!i18n.hasResourceBundle(language, "translation")) {
        i18n.addResourceBundle(language, "translation", resources, true, true);
    }
}

export async function setLanguage(language: DisplayLanguage): Promise<void> {
    await ensureLanguageResources(language);
    await i18n.changeLanguage(language);
    if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, language);
    }
}
