import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
    hubClientLogin,
    hubClientProvision,
    hubStaffActivatePasswordState,
    hubStaffPasswordState,
} from "../api/hub";
import type { HubClientLoginResponse } from "../api/types";
import {
    fetchClientLanguage,
    fetchStaffLanguage,
    updateClientLanguage,
    updateStaffLanguage,
} from "../api/profile";
import { getSupabaseClient } from "../api/supabase";
import { LanguageModal } from "../components/LanguageModal";
import { setLanguage } from "../i18n";
import { loginWithPassword } from "../matrix/login";
import "./AuthPage.css";

type EntryMode = "client" | "company";

export function AuthPage() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
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
    const [companyBusy, setCompanyBusy] = useState(false);
    const [companyError, setCompanyError] = useState<string | null>(null);
    const [companySuccess, setCompanySuccess] = useState<string | null>(null);
    const [showForceReset, setShowForceReset] = useState(false);
    const [forceResetAccessToken, setForceResetAccessToken] = useState("");
    const [forceResetHsUrl, setForceResetHsUrl] = useState("");
    const [forceResetUserId, setForceResetUserId] = useState("");
    const [forceResetInitialPassword, setForceResetInitialPassword] = useState("");
    const [showLanguageModal, setShowLanguageModal] = useState(false);
    const [pendingLanguageContext, setPendingLanguageContext] = useState<{
        accessToken: string;
        hsUrl?: string;
        userType: "client" | "staff";
    } | null>(null);

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
                const language = await fetchClientLanguage(response.matrix.access_token);
                if (!language) {
                    setPendingLanguageContext({
                        accessToken: response.matrix.access_token,
                        userType: "client",
                    });
                    setShowLanguageModal(true);
                    return;
                }
                setLanguage(language === "zh-CN" ? "zh-CN" : "en");
                navigate("/app");
            } catch (error) {
                setClientError(error instanceof Error ? error.message : t("auth.errors.generic"));
            } finally {
                setClientBusy(false);
            }
        })();
    };

    const onSubmitCompany = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        void (async (): Promise<void> => {
            setCompanyBusy(true);
            setCompanyError(null);
            setCompanySuccess(null);
            try {
                const normalizedSlug = companySlug.trim().toLowerCase();
                if (!normalizedSlug || !companyUsername.trim() || !companyPassword.trim()) {
                    throw new Error(t("auth.errors.missingLoginFields"));
                }
                if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
                    throw new Error(t("auth.errors.invalidCompanySlug"));
                }
                const hsUrl = `https://matrix.${normalizedSlug}.com`;
                const credentials = await loginWithPassword(hsUrl, companyUsername.trim(), companyPassword);
                const passwordState = await hubStaffPasswordState(credentials.accessToken, credentials.homeserverUrl);
                if (passwordState.password_state === "RESET_REQUIRED") {
                    setForceResetAccessToken(credentials.accessToken);
                    setForceResetHsUrl(credentials.homeserverUrl);
                    setForceResetUserId(credentials.userId);
                    setForceResetInitialPassword(companyPassword);
                    setShowForceReset(true);
                    return;
                }
                setCompanySuccess(t("auth.company.loginSuccess"));
                const language = await fetchStaffLanguage(credentials.accessToken, credentials.homeserverUrl);
                if (!language) {
                    setPendingLanguageContext({
                        accessToken: credentials.accessToken,
                        hsUrl: credentials.homeserverUrl,
                        userType: "staff",
                    });
                    setShowLanguageModal(true);
                    return;
                }
                setLanguage(language === "zh-CN" ? "zh-CN" : "en");
                navigate("/app");
            } catch (error) {
                setCompanyError(error instanceof Error ? error.message : t("auth.errors.generic"));
            } finally {
                setCompanyBusy(false);
            }
        })();
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
                            <button type="submit" className="gt_primary" disabled={clientBusy}>
                                {clientBusy ? t("auth.client.loginBusy") : t("auth.client.loginAction")}
                            </button>
                            <button
                                type="button"
                                className="gt_secondary"
                                onClick={() => setShowClientRegister(true)}
                                disabled={clientBusy}
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
                            <button type="submit" className="gt_primary" disabled={companyBusy}>
                                {companyBusy ? t("auth.company.loginBusy") : t("auth.company.loginAction")}
                            </button>
                        </div>
                        <button type="button" className="gt_link">
                            {t("auth.company.forgotPassword")}
                        </button>
                        {companyError && <div className="gt_error">{companyError}</div>}
                        {companySuccess && <div className="gt_success">{companySuccess}</div>}
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
                                disabled={registerBusy}
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

            {showForceReset && (
                <div className="gt_modalBackdrop">
                    <div className="gt_modal">
                        <div className="gt_modalHeader">
                            <h3>{t("auth.company.resetTitle")}</h3>
                            <button
                                type="button"
                                className="gt_modalClose"
                                onClick={() => setShowForceReset(false)}
                                disabled
                            >
                                ×
                            </button>
                        </div>
                        <ForcePasswordResetForm
                            accessToken={forceResetAccessToken}
                            hsUrl={forceResetHsUrl}
                            userId={forceResetUserId}
                            initialPassword={forceResetInitialPassword}
                            onComplete={async (): Promise<void> => {
                                try {
                                    await hubStaffActivatePasswordState(forceResetAccessToken, forceResetHsUrl);
                                    setShowForceReset(false);
                                    setPendingLanguageContext({
                                        accessToken: forceResetAccessToken,
                                        hsUrl: forceResetHsUrl,
                                        userType: "staff",
                                    });
                                    setShowLanguageModal(true);
                                } catch (error) {
                                    setCompanyError(
                                        error instanceof Error ? error.message : t("auth.errors.generic"),
                                    );
                                }
                            }}
                            onCancel={() => setShowForceReset(false)}
                        />
                    </div>
                </div>
            )}
            <LanguageModal
                open={showLanguageModal}
                onSave={async (language): Promise<void> => {
                    if (!pendingLanguageContext) return;
                    if (pendingLanguageContext.userType === "client") {
                        await updateClientLanguage(pendingLanguageContext.accessToken, language);
                    } else {
                        await updateStaffLanguage(
                            pendingLanguageContext.accessToken,
                            pendingLanguageContext.hsUrl ?? "",
                            language,
                        );
                    }
                    setLanguage(language);
                    setShowLanguageModal(false);
                    setPendingLanguageContext(null);
                    navigate("/app");
                }}
            />
        </div>
    );
}

type ForcePasswordResetProps = {
    accessToken: string;
    hsUrl: string;
    userId: string;
    initialPassword: string;
    onComplete: () => Promise<void>;
    onCancel: () => void;
};

function ForcePasswordResetForm({
    accessToken,
    hsUrl,
    userId,
    initialPassword,
    onComplete,
    onCancel,
}: ForcePasswordResetProps) {
    const { t } = useTranslation();
    const [currentPassword, setCurrentPassword] = useState(initialPassword);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isValidPassword = (value: string): boolean => {
        if (value.length < 10) return false;
        return /[A-Za-z]/.test(value) && /\d/.test(value);
    };

    const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        void (async (): Promise<void> => {
            setError(null);
            if (!currentPassword || !newPassword) {
                setError(t("auth.errors.emptyPassword"));
                return;
            }
            if (newPassword !== confirmPassword) {
                setError(t("auth.errors.passwordMismatch"));
                return;
            }
            if (!isValidPassword(newPassword)) {
                setError(t("auth.errors.passwordWeak"));
                return;
            }
            setBusy(true);
            try {
                await changeMatrixPassword(hsUrl, accessToken, userId, currentPassword, newPassword);
                await onComplete();
            } catch (error) {
                setError(error instanceof Error ? error.message : t("auth.errors.generic"));
            } finally {
                setBusy(false);
            }
        })();
    };

    return (
        <form className="gt_form" onSubmit={onSubmit}>
            <div className="gt_hint">{t("auth.company.resetHint")}</div>
            <label className="gt_field">
                <span>{t("auth.fields.currentPasswordLabel")}</span>
                <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                />
            </label>
            <label className="gt_field">
                <span>{t("auth.fields.newPasswordLabel")}</span>
                <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                />
            </label>
            <label className="gt_field">
                <span>{t("auth.fields.confirmPasswordLabel")}</span>
                <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                />
            </label>
            {error && <div className="gt_error">{error}</div>}
            <div className="gt_actions">
                <button type="submit" className="gt_primary" disabled={busy}>
                    {busy ? t("auth.company.resetBusy") : t("auth.company.resetConfirm")}
                </button>
                <button type="button" className="gt_secondary" onClick={onCancel} disabled={busy}>
                    {t("auth.company.resetCancel")}
                </button>
            </div>
        </form>
    );
}

async function changeMatrixPassword(
    hsUrl: string,
    accessToken: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
): Promise<void> {
    const url = new URL("/_matrix/client/v3/account/password", hsUrl);
    const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            auth: {
                type: "m.login.password",
                identifier: {
                    type: "m.id.user",
                    user: userId,
                },
                password: currentPassword,
            },
            new_password: newPassword,
            logout_devices: false,
        }),
    });

    if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const data = (await response.json()) as { error?: string };
            if (data?.error) {
                throw new Error(data.error);
            }
        }
        const text = await response.text();
        throw new Error(text || `Request failed (${response.status})`);
    }
}
