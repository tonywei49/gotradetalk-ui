import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { hubClientLogin, hubClientProvision } from "./api/hub";
import { getSupabaseClient } from "./api/supabase";
import type { HubClientLoginResponse } from "./api/types";
import { setLanguage } from "./i18n";
import "./App.css";

type EntryMode = "client" | "company";

function App() {
    const { t, i18n } = useTranslation();
    const [activeEntry, setActiveEntry] = useState<EntryMode>("client");
    const [clientUsername, setClientUsername] = useState("");
    const [clientPassword, setClientPassword] = useState("");
    const [clientBusy, setClientBusy] = useState(false);
    const [clientError, setClientError] = useState<string | null>(null);
    const [clientSuccess, setClientSuccess] = useState<HubClientLoginResponse | null>(null);
    const [showClientRegister, setShowClientRegister] = useState(false);
    const [registerEmail, setRegisterEmail] = useState("");
    const [registerPassword, setRegisterPassword] = useState("");
    const [registerUserLocalId, setRegisterUserLocalId] = useState("");
    const [registerCompanyName, setRegisterCompanyName] = useState("");
    const [registerBusy, setRegisterBusy] = useState(false);
    const [registerError, setRegisterError] = useState<string | null>(null);
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
        void (async (): Promise<void> => {
            setClientBusy(true);
            setClientError(null);
            setClientSuccess(null);
            try {
                if (!clientUsername.trim() || !clientPassword.trim()) {
                    throw new Error(t("auth.errors.missingLoginFields"));
                }
                const response = await hubClientLogin(clientUsername.trim(), clientPassword.trim());
                setClientSuccess(response);
            } catch (error) {
                setClientError(error instanceof Error ? error.message : t("auth.errors.generic"));
            } finally {
                setClientBusy(false);
            }
        })();
    };

    const onSubmitCompany = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        // TODO: integrate with Matrix password login + hub password state check.
    };

    const onSubmitClientRegister = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        void (async (): Promise<void> => {
            setRegisterBusy(true);
            setRegisterError(null);
            try {
                if (!registerEmail.trim() || !registerPassword.trim()) {
                    throw new Error(t("auth.errors.missingRegisterFields"));
                }
                const supabase = getSupabaseClient();
                const { data, error } = await supabase.auth.signUp({
                    email: registerEmail.trim(),
                    password: registerPassword.trim(),
                });
                if (error) {
                    throw new Error(error.message);
                }
                const session = data.session;
                if (!session?.access_token) {
                    throw new Error(t("auth.errors.missingSupabaseSession"));
                }
                await hubClientProvision(session.access_token, {
                    user_local_id: registerUserLocalId.trim(),
                    company_name: registerCompanyName.trim(),
                    password: registerPassword.trim(),
                });
                setShowClientRegister(false);
                setRegisterEmail("");
                setRegisterPassword("");
                setRegisterUserLocalId("");
                setRegisterCompanyName("");
            } catch (error) {
                setRegisterError(error instanceof Error ? error.message : t("auth.errors.generic"));
            } finally {
                setRegisterBusy(false);
            }
        })();
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
                                {clientBusy ? t("auth.client.loginBusy") : t("auth.client.loginAction")}
                            </button>
                            <button
                                type="button"
                                className="gt_secondary"
                                onClick={() => setShowClientRegister(true)}
                            >
                                {t("auth.client.registerAction")}
                            </button>
                        </div>
                        <button type="button" className="gt_link">
                            {t("auth.client.forgotPassword")}
                        </button>
                        {clientError && <div className="gt_error">{clientError}</div>}
                        {clientSuccess && (
                            <div className="gt_success">{t("auth.client.loginSuccess")}</div>
                        )}
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
            {showClientRegister && (
                <div className="gt_modalBackdrop">
                    <div className="gt_modal">
                        <div className="gt_modalHeader">
                            <h3>{t("auth.client.registerTitle")}</h3>
                            <button
                                type="button"
                                className="gt_modalClose"
                                onClick={() => setShowClientRegister(false)}
                            >
                                ×
                            </button>
                        </div>
                        <form className="gt_form" onSubmit={onSubmitClientRegister}>
                            <label className="gt_field">
                                <span>{t("auth.fields.emailLabel")}</span>
                                <input
                                    type="email"
                                    placeholder={t("auth.fields.emailPlaceholder")}
                                    value={registerEmail}
                                    onChange={(event) => setRegisterEmail(event.target.value)}
                                    autoComplete="email"
                                />
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.passwordLabel")}</span>
                                <input
                                    type="password"
                                    placeholder={t("auth.fields.passwordPlaceholder")}
                                    value={registerPassword}
                                    onChange={(event) => setRegisterPassword(event.target.value)}
                                    autoComplete="new-password"
                                />
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.userLocalIdLabel")}</span>
                                <input
                                    type="text"
                                    placeholder={t("auth.fields.userLocalIdPlaceholder")}
                                    value={registerUserLocalId}
                                    onChange={(event) => setRegisterUserLocalId(event.target.value)}
                                />
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.companyNameLabel")}</span>
                                <input
                                    type="text"
                                    placeholder={t("auth.fields.companyNamePlaceholder")}
                                    value={registerCompanyName}
                                    onChange={(event) => setRegisterCompanyName(event.target.value)}
                                />
                            </label>
                            {registerError && <div className="gt_error">{registerError}</div>}
                            <div className="gt_actions">
                                <button type="submit" className="gt_primary" disabled={registerBusy}>
                                    {registerBusy
                                        ? t("auth.client.registerBusy")
                                        : t("auth.client.registerConfirm")}
                                </button>
                                <button
                                    type="button"
                                    className="gt_secondary"
                                    onClick={() => setShowClientRegister(false)}
                                >
                                    {t("auth.client.registerCancel")}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
