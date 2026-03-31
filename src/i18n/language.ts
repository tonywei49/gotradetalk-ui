import i18n from "i18next";
import type { DisplayLanguage } from "../constants/displayLanguages";

const STORAGE_KEY = "gt_lang";

export function setLanguage(language: DisplayLanguage): void {
    void i18n.changeLanguage(language);
    if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, language);
    }
}
