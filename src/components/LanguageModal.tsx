import { useState } from "react";
import { useTranslation } from "react-i18next";

import "./LanguageModal.css";

type LanguageModalProps = {
    open: boolean;
    onSave: (language: "en" | "zh-CN") => Promise<void>;
};

export function LanguageModal({ open, onSave }: LanguageModalProps) {
    const { t } = useTranslation();
    const [language, setLanguage] = useState<"en" | "zh-CN" | "">("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!open) return null;

    const handleSave = (): void => {
        void (async (): Promise<void> => {
            if (!language) {
                setError(t("languageModal.required"));
                return;
            }
            setBusy(true);
            setError(null);
            try {
                await onSave(language);
            } catch (saveError) {
                setError(saveError instanceof Error ? saveError.message : t("auth.errors.generic"));
            } finally {
                setBusy(false);
            }
        })();
    };

    return (
        <div className="gt_modalBackdrop">
            <div className="gt_modal gt_languageModal">
                <div className="gt_modalHeader">
                    <h3>{t("languageModal.title")}</h3>
                </div>
                <p className="gt_modalSubtitle">{t("languageModal.subtitle")}</p>
                <div className="gt_languageOptions">
                    <label className="gt_languageOption">
                        <input
                            type="radio"
                            name="language"
                            value="en"
                            checked={language === "en"}
                            onChange={() => setLanguage("en")}
                        />
                        <span>{t("language.english")}</span>
                    </label>
                    <label className="gt_languageOption">
                        <input
                            type="radio"
                            name="language"
                            value="zh-CN"
                            checked={language === "zh-CN"}
                            onChange={() => setLanguage("zh-CN")}
                        />
                        <span>{t("language.chineseSimplified")}</span>
                    </label>
                </div>
                {error && <div className="gt_error">{error}</div>}
                <div className="gt_actions">
                    <button type="button" className="gt_primary" onClick={handleSave} disabled={busy}>
                        {busy ? t("languageModal.saving") : t("languageModal.save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
