import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import type { DisplayLanguage } from "../constants/displayLanguages";
import en from "./en.json";
import { DEFAULT_LANGUAGE, ensureLanguageResources, getStoredLanguage } from "./language";

const storedLanguage = getStoredLanguage();
const initialLanguage: DisplayLanguage = storedLanguage ?? DEFAULT_LANGUAGE;

void i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
    },
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: {
        escapeValue: false,
    },
});

if (initialLanguage !== DEFAULT_LANGUAGE) {
    void ensureLanguageResources(initialLanguage)
        .then(() => i18n.changeLanguage(initialLanguage))
        .catch((error) => {
            console.warn("Failed to load language resources:", error);
        });
}

export default i18n;
