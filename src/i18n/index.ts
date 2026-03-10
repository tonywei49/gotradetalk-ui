import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { isSupportedDisplayLanguage, type DisplayLanguage } from "../constants/displayLanguages";
import en from "./en.json";
import ar from "./ar.json";
import es from "./es.json";
import fr from "./fr.json";
import id from "./id.json";
import it from "./it.json";
import ja from "./ja.json";
import pt from "./pt.json";
import ru from "./ru.json";
import vi from "./vi.json";
import zhCN from "./zh-CN.json";

const STORAGE_KEY = "gt_lang";
const defaultLanguage: DisplayLanguage = "en";

const storedLanguage = (() => {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isSupportedDisplayLanguage(value) ? value : null;
})();

void i18n.use(initReactI18next).init({
    resources: {
        ar: { translation: ar },
        en: { translation: en },
        es: { translation: es },
        fr: { translation: fr },
        id: { translation: id },
        it: { translation: it },
        ja: { translation: ja },
        pt: { translation: pt },
        ru: { translation: ru },
        vi: { translation: vi },
        "zh-CN": { translation: zhCN },
    },
    lng: storedLanguage ?? defaultLanguage,
    fallbackLng: defaultLanguage,
    interpolation: {
        escapeValue: false,
    },
});

export function setLanguage(language: DisplayLanguage): void {
    void i18n.changeLanguage(language);
    if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, language);
    }
}

export default i18n;
