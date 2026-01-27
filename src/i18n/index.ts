import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";
import zhCN from "./zh-CN.json";

const STORAGE_KEY = "gt_lang";
const defaultLanguage = "en";

const storedLanguage = (() => {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && (value === "en" || value === "zh-CN") ? value : null;
})();

void i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        "zh-CN": { translation: zhCN },
    },
    lng: storedLanguage ?? defaultLanguage,
    fallbackLng: defaultLanguage,
    interpolation: {
        escapeValue: false,
    },
});

export function setLanguage(language: "en" | "zh-CN"): void {
    void i18n.changeLanguage(language);
    if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, language);
    }
}

export default i18n;
