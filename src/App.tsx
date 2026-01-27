import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { setLanguage } from "./i18n";
import "./App.css";

type EntryMode = "client" | "company";

function App() {
    const { t, i18n } = useTranslation();
    const [activeEntry, setActiveEntry] = useState<EntryMode>("client");
    const [clientUsername, setClientUsername] = useState("");
    const [clientPassword, setClientPassword] = useState("");
    const [companySlug, setCompanySlug] = useState("");
    const [companyUsername, setCompanyUsername] = useState("");
    const [companyPassword, setCompanyPassword] = useState("");

    const hsPreview = useMemo(() => {
        const trimmed = companySlug.trim().toLowerCase();
        if (!trimmed) return "https://matrix.{slug}.com";
        return `https://matrix.${trimmed}.com`;
    }, [companySlug]);

    const onSwitchLanguage = (language: "en" | "zh-CN"): void => {
        setLanguage(language);
    };

    const onSubmitClient = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        // TODO: integrate with Supabase + Hub client login/provision.
    };

    const onSubmitCompany = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        // TODO: integrate with Matrix password login + hub password state check.
    };

    return (
        <div className="gt_app">
            <header className="gt_header">
                <div>
                    <div className="gt_title">{t("app.title")}</div>
                    <div className="gt_subtitle">{t("app.subtitle")}</div>
                </div>
                <div className="gt_lang">
                    <span className="gt_langLabel">{t("language.label")}</span>
                    <button
                        type="button"
                        className={i18n.language === "en" ? "gt_langButton active" : "gt_langButton"}
                        onClick={() => onSwitchLanguage("en")}
                    >
                        {t("language.english")}
                    </button>
                    <button
                        type="button"
                        className={i18n.language === "zh-CN" ? "gt_langButton active" : "gt_langButton"}
                        onClick={() => onSwitchLanguage("zh-CN")}
                    >
                        {t("language.chineseSimplified")}
                    </button>
                </div>
            </header>

            <main className="gt_auth">
                <nav className="gt_tabs">
                    <button
                        type="button"
                        className={activeEntry === "client" ? "gt_tab active" : "gt_tab"}
                        onClick={() => setActiveEntry("client")}
                    >
                        {t("auth.tabs.client")}
                    </button>
                    <button
                        type="button"
                        className={activeEntry === "company" ? "gt_tab active" : "gt_tab"}
                        onClick={() => setActiveEntry("company")}
                    >
                        {t("auth.tabs.company")}
                    </button>
                </nav>

                <section className={activeEntry === "client" ? "gt_panel active" : "gt_panel"}>
                    <div className="gt_cardHeader">
                        <h2>{t("auth.client.title")}</h2>
                        <p>{t("auth.client.subtitle")}</p>
                    </div>
                    <form className="gt_form" onSubmit={onSubmitClient}>
                        <label className="gt_field">
                            <span>{t("auth.fields.usernameLabel")}</span>
                            <input
                                type="text"
                                placeholder={t("auth.fields.usernamePlaceholder")}
                                value={clientUsername}
                                onChange={(event) => setClientUsername(event.target.value)}
                                autoComplete="username"
                            />
                        </label>
                        <label className="gt_field">
                            <span>{t("auth.fields.passwordLabel")}</span>
                            <input
                                type="password"
                                placeholder={t("auth.fields.passwordPlaceholder")}
                                value={clientPassword}
                                onChange={(event) => setClientPassword(event.target.value)}
                                autoComplete="current-password"
                            />
                        </label>
                        <div className="gt_actions">
                            <button type="submit" className="gt_primary">
                                {t("auth.client.loginAction")}
                            </button>
                            <button type="button" className="gt_secondary">
                                {t("auth.client.registerAction")}
                            </button>
                        </div>
                        <button type="button" className="gt_link">
                            {t("auth.client.forgotPassword")}
                        </button>
                    </form>
                </section>

                <section className={activeEntry === "company" ? "gt_panel active" : "gt_panel"}>
                    <div className="gt_cardHeader">
                        <h2>{t("auth.company.title")}</h2>
                        <p>{t("auth.company.subtitle")}</p>
                    </div>
                    <form className="gt_form" onSubmit={onSubmitCompany}>
                        <label className="gt_field">
                            <span>{t("auth.fields.companySlugLabel")}</span>
                            <input
                                type="text"
                                placeholder={t("auth.fields.companySlugPlaceholder")}
                                value={companySlug}
                                onChange={(event) => setCompanySlug(event.target.value)}
                                autoComplete="organization"
                            />
                        </label>
                        <label className="gt_field">
                            <span>{t("auth.fields.usernameLabel")}</span>
                            <input
                                type="text"
                                placeholder={t("auth.fields.usernamePlaceholder")}
                                value={companyUsername}
                                onChange={(event) => setCompanyUsername(event.target.value)}
                                autoComplete="username"
                            />
                        </label>
                        <label className="gt_field">
                            <span>{t("auth.fields.passwordLabel")}</span>
                            <input
                                type="password"
                                placeholder={t("auth.fields.passwordPlaceholder")}
                                value={companyPassword}
                                onChange={(event) => setCompanyPassword(event.target.value)}
                                autoComplete="current-password"
                            />
                        </label>
                        <div className="gt_hint">{t("auth.notes.companyHint", { hs: hsPreview })}</div>
                        <div className="gt_actions">
                            <button type="submit" className="gt_primary">
                                {t("auth.company.loginAction")}
                            </button>
                        </div>
                        <button type="button" className="gt_link">
                            {t("auth.company.forgotPassword")}
                        </button>
                    </form>
                </section>
            </main>
        </div>
    );
}

export default App;
