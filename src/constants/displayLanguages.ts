export const displayLanguageOptions = [
    { value: "en", label: "English" },
    { value: "zh-CN", label: "简体中文" },
    { value: "ja", label: "日本語" },
    { value: "vi", label: "Tiếng Việt" },
    { value: "id", label: "Bahasa Indonesia" },
    { value: "es", label: "Español" },
    { value: "pt", label: "Português" },
    { value: "fr", label: "Français" },
    { value: "it", label: "Italiano" },
    { value: "ar", label: "العربية" },
    { value: "ru", label: "Русский" },
] as const;

export type DisplayLanguage = (typeof displayLanguageOptions)[number]["value"];

export function isSupportedDisplayLanguage(value: string | null | undefined): value is DisplayLanguage {
    if (!value) return false;
    return displayLanguageOptions.some((option) => option.value === value);
}
