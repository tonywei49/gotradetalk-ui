import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
    hubClientLogin,
    hubClientProvision,
    hubStaffExchangeSession,
    hubStaffActivatePasswordState,
    hubStaffPasswordState,
} from "../api/hub";
import type { HubClientLoginResponse, HubSupabaseSession } from "../api/types";
import {
    fetchClientLanguage,
    fetchStaffLanguage,
    updateClientLanguage,
    updateStaffLanguage,
} from "../api/profile";
import { getSupabaseClient } from "../api/supabase";
import { displayLanguageOptions, isSupportedDisplayLanguage, type DisplayLanguage } from "../constants/displayLanguages";
import { translationLanguageOptions } from "../constants/translationLanguages";
import { LanguageModal } from "../components/LanguageModal";
import { setLanguage } from "../i18n/language";
import { loginWithPassword } from "../matrix/login";
import { useAuthStore } from "../stores/AuthStore";
import { useToastStore } from "../stores/ToastStore";
import { mapAuthErrorToMessage } from "../utils/errorMessages";
import { getClientLoginSessionMetadata } from "../utils/clientSession";
import "./AuthPage.css";

type EntryMode = "client" | "company";

export function AuthPage() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const setAuthSession = useAuthStore((state) => state.setSession);
    const pushToast = useToastStore((state) => state.pushToast);
    const [activeEntry, setActiveEntry] = useState<EntryMode>("client");
    const [clientUsername, setClientUsername] = useState("");
    const [clientPassword, setClientPassword] = useState("");
    const [clientBusy, setClientBusy] = useState(false);
    const [clientError, setClientError] = useState<string | null>(null);
    const [clientSuccess, setClientSuccess] = useState<HubClientLoginResponse | null>(null);
    const [showClientRegister, setShowClientRegister] = useState(false);
    const [showClientReset, setShowClientReset] = useState(false);
    const [resetEmail, setResetEmail] = useState("");
    const [resetBusy, setResetBusy] = useState(false);
    const [resetError, setResetError] = useState<string | null>(null);
    const [resetSuccess, setResetSuccess] = useState<string | null>(null);
    const [registerEmail, setRegisterEmail] = useState("");
    const [registerPassword, setRegisterPassword] = useState("");
    const [registerUserLocalId, setRegisterUserLocalId] = useState("");
    const [registerCompanyName, setRegisterCompanyName] = useState("");
    const [registerCountry, setRegisterCountry] = useState("");
    const [registerGender, setRegisterGender] = useState("");
    const [registerJobTitle, setRegisterJobTitle] = useState("");
    const [registerTranslationLocale, setRegisterTranslationLocale] = useState("");
    const [registerLanguage, setRegisterLanguage] = useState("en");
    const [registerBusy, setRegisterBusy] = useState(false);
    const [registerError, setRegisterError] = useState<string | null>(null);
    const [companySlug, setCompanySlug] = useState("");
    const [companyTld, setCompanyTld] = useState("com");
    const [companyTldEditable, setCompanyTldEditable] = useState(false);
    const [companyUsername, setCompanyUsername] = useState("");
    const [companyPassword, setCompanyPassword] = useState("");
    const [companyBusy, setCompanyBusy] = useState(false);
    const [companyError, setCompanyError] = useState<string | null>(null);
    const [companySuccess, setCompanySuccess] = useState<string | null>(null);
    const [showForceReset, setShowForceReset] = useState(false);
    const [forceResetAccessToken, setForceResetAccessToken] = useState("");
    const [forceResetHsUrl, setForceResetHsUrl] = useState("");
    const [forceResetUserId, setForceResetUserId] = useState("");
    const [forceResetDeviceId, setForceResetDeviceId] = useState("");
    const [forceResetInitialPassword, setForceResetInitialPassword] = useState("");
    const [showLanguageModal, setShowLanguageModal] = useState(false);
    const [pendingLanguageContext, setPendingLanguageContext] = useState<
        | {
              userType: "client";
              session: HubSupabaseSession;
              matrixCredentials: HubClientLoginResponse["matrix"];
          }
        | {
              userType: "staff";
              accessToken: string;
              hsUrl: string;
              matrixUserId: string;
              hubSession: HubSupabaseSession;
              matrixCredentials: HubClientLoginResponse["matrix"];
          }
        | null
    >(null);
    const clientSessionMetadata = getClientLoginSessionMetadata();

    const ensureHubSessionForStaff = async (params: {
        username: string;
        password: string;
        matrixAccessToken: string;
        hsUrl: string;
        matrixUserId: string;
        matrixDeviceId?: string | null;
    }): Promise<HubSupabaseSession> => {
        if (params.username.includes("@")) {
            try {
                const login = await hubClientLogin(params.username, params.password, undefined, clientSessionMetadata);
                if (login.supabase?.access_token?.startsWith("eyJ")) {
                    return {
                        access_token: login.supabase.access_token,
                        refresh_token: login.supabase.refresh_token || "",
                        expires_at: login.supabase.expires_at,
                    };
                }
            } catch {
                // fallback to matrix->hub exchange
            }
        }

        const exchanged = await hubStaffExchangeSession({
            matrixAccessToken: params.matrixAccessToken,
            hsUrl: params.hsUrl,
            password: params.password,
            matrixUserId: params.matrixUserId,
            matrixDeviceId: params.matrixDeviceId,
            sessionMetadata: clientSessionMetadata,
        });
        if (!exchanged.access_token || !exchanged.access_token.startsWith("eyJ")) {
            throw new Error("NO_VALID_HUB_TOKEN");
        }
        return {
            access_token: exchanged.access_token,
            refresh_token: exchanged.refresh_token || "",
            expires_at: exchanged.expires_at,
        };
    };

    useEffect(() => {
        const supabase = getSupabaseClient();
        const { data } = supabase.auth.onAuthStateChange((event) => {
            if (event === "PASSWORD_RECOVERY") {
                navigate("/reset-password");
            }
        });
        return () => {
            data.subscription.unsubscribe();
        };
    }, [navigate]);

    const onSwitchLanguage = (language: DisplayLanguage): void => {
        setLanguage(language);
    };

    const onGoogleLogin = (): void => {
        const supabase = getSupabaseClient();
        void supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${window.location.origin}/oauth`,
            },
        });
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
                const account = clientUsername.trim();
                const password = clientPassword.trim();
                const isEmail = account.includes("@");
                let hubSession: HubSupabaseSession | null = null;
                let response: HubClientLoginResponse;

                if (isEmail) {
                    const supabase = getSupabaseClient();
                    const { data, error } = await supabase.auth.signInWithPassword({
                        email: account,
                        password,
                    });
                    if (error) {
                        throw new Error(error.message);
                    }
                    const session = data.session;
                    if (!session?.access_token) {
                        throw new Error(t("auth.errors.missingSupabaseSession"));
                    }
                    response = await hubClientLogin(account, password, session.access_token, clientSessionMetadata);
                    hubSession = response.supabase ?? {
                        access_token: session.access_token,
                        refresh_token: session.refresh_token,
                        expires_at: session.expires_at ?? undefined,
                    };
                } else {
                    response = await hubClientLogin(account, password, undefined, clientSessionMetadata);
                    hubSession = response.supabase ?? null;
                }
                setClientSuccess(response);
                if (!hubSession) {
                    throw new Error(t("auth.errors.missingSupabaseSession"));
                }
                const language = await fetchClientLanguage(hubSession);
                if (!language) {
                    setPendingLanguageContext({
                        session: hubSession,
                        userType: "client",
                        matrixCredentials: response.matrix,
                    });
                    setShowLanguageModal(true);
                    return;
                }
                setLanguage(isSupportedDisplayLanguage(language) ? language : "en");
                setAuthSession({
                    userType: "client",
                    matrixCredentials: response.matrix,
                    hubSession,
                });
                navigate("/app");
            } catch (error) {
                const message = mapAuthErrorToMessage(t, error);
                setClientError(message);
                pushToast("error", message);
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
                const normalizedTld = normalizeCompanyTld(companyTld);
                if (!normalizedTld || !/^[a-z0-9.-]+$/.test(normalizedTld)) {
                    throw new Error(t("auth.errors.invalidCompanyTld"));
                }
                const hsUrl = `https://matrix.${normalizedSlug}.${normalizedTld}`;
                const credentials = await loginWithPassword(hsUrl, companyUsername.trim(), companyPassword);
                const passwordState = await hubStaffPasswordState(credentials.accessToken, credentials.homeserverUrl);
                const hubSession = await ensureHubSessionForStaff({
                    username: companyUsername.trim(),
                    password: companyPassword,
                    matrixAccessToken: credentials.accessToken,
                    hsUrl: credentials.homeserverUrl,
                    matrixUserId: credentials.userId,
                    matrixDeviceId: credentials.deviceId,
                });
                if (passwordState.password_state === "RESET_REQUIRED") {
                    setForceResetAccessToken(credentials.accessToken);
                    setForceResetHsUrl(credentials.homeserverUrl);
                    setForceResetUserId(credentials.userId);
                    setForceResetDeviceId(credentials.deviceId);
                    setForceResetInitialPassword(companyPassword);
                    setShowForceReset(true);
                    return;
                }
                setCompanySuccess(t("auth.company.loginSuccess"));
                const language = await fetchStaffLanguage(credentials.accessToken, credentials.homeserverUrl);
                if (!language) {
                    setPendingLanguageContext({
                        userType: "staff",
                        matrixUserId: credentials.userId,
                        accessToken: credentials.accessToken,
                        hsUrl: credentials.homeserverUrl,
                        hubSession,
                        matrixCredentials: {
                            access_token: credentials.accessToken,
                            device_id: credentials.deviceId,
                            user_id: credentials.userId,
                            hs_url: credentials.homeserverUrl,
                        },
                    });
                    setShowLanguageModal(true);
                    return;
                }
                setLanguage(isSupportedDisplayLanguage(language) ? language : "en");
                setAuthSession({
                    userType: "staff",
                    matrixCredentials: {
                        access_token: credentials.accessToken,
                        device_id: credentials.deviceId,
                        user_id: credentials.userId,
                        hs_url: credentials.homeserverUrl,
                    },
                    hubSession,
                });
                navigate("/app");
            } catch (error) {
                const message = mapAuthErrorToMessage(t, error);
                setCompanyError(message);
                pushToast("error", message);
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
                if (!registerCountry.trim()) {
                    throw new Error(t("auth.errors.missingCountry"));
                }
                if (!registerTranslationLocale.trim()) {
                    throw new Error(t("auth.errors.missingTranslationLocale"));
                }
                if (!registerLanguage) {
                    throw new Error(t("auth.errors.missingRegisterLanguage"));
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
                    country: registerCountry.trim(),
                    translation_locale: registerTranslationLocale.trim(),
                    password: registerPassword.trim(),
                    gender: registerGender.trim() || undefined,
                    job_title: registerJobTitle.trim() || undefined,
                });
                await updateClientLanguage(
                    {
                        access_token: session.access_token,
                        refresh_token: session.refresh_token,
                        expires_at: session.expires_at ?? undefined,
                    },
                    registerLanguage,
                );
                setShowClientRegister(false);
                setRegisterEmail("");
                setRegisterPassword("");
                setRegisterUserLocalId("");
                setRegisterCompanyName("");
                setRegisterCountry("");
                setRegisterGender("");
                setRegisterJobTitle("");
                setRegisterTranslationLocale("");
                setRegisterLanguage("en");
            } catch (error) {
                const message = mapAuthErrorToMessage(t, error);
                setRegisterError(message);
                pushToast("error", message);
            } finally {
                setRegisterBusy(false);
            }
        })();
    };

    const onSubmitClientReset = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        void (async (): Promise<void> => {
            setResetBusy(true);
            setResetError(null);
            setResetSuccess(null);
            try {
                const email = resetEmail.trim();
                if (!email) {
                    throw new Error(t("auth.errors.missingResetEmail"));
                }
                const supabase = getSupabaseClient();
                const { error } = await supabase.auth.resetPasswordForEmail(email);
                if (error) {
                    throw new Error(error.message);
                }
                setResetSuccess(t("auth.client.resetSuccess"));
            } catch (error) {
                const message = mapAuthErrorToMessage(t, error);
                setResetError(message);
                pushToast("error", message);
            } finally {
                setResetBusy(false);
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
                    <label className="gt_langLabel" htmlFor="gt_lang_select">
                        {t("language.label")}
                    </label>
                    <select
                        id="gt_lang_select"
                        className="gt_langSelect"
                        value={isSupportedDisplayLanguage(i18n.language) ? i18n.language : "en"}
                        onChange={(event) => onSwitchLanguage(event.target.value as DisplayLanguage)}
                    >
                        {displayLanguageOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
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
                                data-testid="auth-client-username"
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
                                data-testid="auth-client-password"
                                placeholder={t("auth.fields.passwordPlaceholder")}
                                value={clientPassword}
                                onChange={(event) => setClientPassword(event.target.value)}
                                autoComplete="current-password"
                            />
                        </label>
                        <div className="gt_actions">
                            <button type="submit" data-testid="auth-client-submit" className="gt_primary" disabled={clientBusy}>
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
                        <div className="gt_separator">{t("auth.client.or")}</div>
                        <button type="button" className="gt_googleButton" onClick={onGoogleLogin} disabled={clientBusy}>
                            {t("auth.client.googleLogin")}
                        </button>
                        <button
                            type="button"
                            className="gt_link"
                            onClick={() => {
                                setResetEmail(clientUsername.trim());
                                setResetError(null);
                                setResetSuccess(null);
                                setShowClientReset(true);
                            }}
                            disabled={clientBusy}
                        >
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
                            <span>{t("auth.fields.companyTldLabel")}</span>
                            <div className="gt_inlineField">
                                <input
                                    type="text"
                                    value={companyTld}
                                    onChange={(event) => setCompanyTld(event.target.value)}
                                    placeholder={t("auth.fields.companyTldPlaceholder")}
                                    disabled={!companyTldEditable}
                                />
                                <button
                                    type="button"
                                    className="gt_secondary gt_inlineButton"
                                    onClick={() => setCompanyTldEditable((current) => !current)}
                                >
                                    {companyTldEditable
                                        ? t("auth.fields.companyTldDone")
                                        : t("auth.fields.companyTldEdit")}
                                </button>
                            </div>
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
                            <label className="gt_field">
                                <span>{t("auth.fields.countryLabel")}</span>
                                <input
                                    type="text"
                                    placeholder={t("auth.fields.countryPlaceholder")}
                                    value={registerCountry}
                                    onChange={(event) => setRegisterCountry(event.target.value)}
                                />
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.jobTitleLabel")}</span>
                                <input
                                    type="text"
                                    placeholder={t("auth.fields.jobTitlePlaceholder")}
                                    value={registerJobTitle}
                                    onChange={(event) => setRegisterJobTitle(event.target.value)}
                                />
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.genderLabel")}</span>
                                <select
                                    value={registerGender}
                                    onChange={(event) => setRegisterGender(event.target.value)}
                                >
                                    <option value="">{t("auth.fields.genderUnknown")}</option>
                                    <option value="male">{t("auth.fields.genderMale")}</option>
                                    <option value="female">{t("auth.fields.genderFemale")}</option>
                                </select>
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.translationLocaleLabel")}</span>
                                <select
                                    value={registerTranslationLocale}
                                    onChange={(event) => setRegisterTranslationLocale(event.target.value)}
                                >
                                    <option value="">{t("auth.fields.translationLocalePlaceholder")}</option>
                                    {translationLanguageOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.languageLabel")}</span>
                                <select
                                    value={registerLanguage}
                                    onChange={(event) => setRegisterLanguage(event.target.value)}
                                >
                                    <option value="en">{t("language.english")}</option>
                                    <option value="zh-CN">{t("language.chineseSimplified")}</option>
                                </select>
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

            {showClientReset && (
                <div className="gt_modalBackdrop">
                    <div className="gt_modal">
                        <div className="gt_modalHeader">
                            <h3>{t("auth.client.resetTitle")}</h3>
                            <button
                                type="button"
                                className="gt_modalClose"
                                onClick={() => setShowClientReset(false)}
                                disabled={resetBusy}
                            >
                                脳
                            </button>
                        </div>
                        <p className="gt_modalSubtitle">{t("auth.client.resetEmailSubtitle")}</p>
                        <form className="gt_form" onSubmit={onSubmitClientReset}>
                            <label className="gt_field">
                                <span>{t("auth.fields.emailLabel")}</span>
                                <input
                                    type="email"
                                    placeholder={t("auth.fields.emailPlaceholder")}
                                    value={resetEmail}
                                    onChange={(event) => setResetEmail(event.target.value)}
                                    autoComplete="email"
                                />
                            </label>
                            {resetError && <div className="gt_error">{resetError}</div>}
                            {resetSuccess && <div className="gt_success">{resetSuccess}</div>}
                            <div className="gt_actions">
                                <button type="submit" className="gt_primary" disabled={resetBusy}>
                                    {resetBusy ? t("auth.client.resetBusy") : t("auth.client.resetConfirm")}
                                </button>
                                <button
                                    type="button"
                                    className="gt_secondary"
                                    onClick={() => setShowClientReset(false)}
                                    disabled={resetBusy}
                                >
                                    {t("auth.client.resetCancel")}
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
                            onComplete={async (newPassword): Promise<void> => {
                                try {
                                    await hubStaffActivatePasswordState(forceResetAccessToken, forceResetHsUrl);
                                    setShowForceReset(false);
                                    const hubSession = await ensureHubSessionForStaff({
                                        username: forceResetUserId.startsWith("@")
                                            ? forceResetUserId.slice(1).split(":")[0]
                                            : forceResetUserId,
                                        password: newPassword,
                                        matrixAccessToken: forceResetAccessToken,
                                        hsUrl: forceResetHsUrl,
                                        matrixUserId: forceResetUserId,
                                        matrixDeviceId: forceResetDeviceId,
                                    });
                                    setPendingLanguageContext({
                                        matrixUserId: forceResetUserId,
                                        userType: "staff",
                                        accessToken: forceResetAccessToken,
                                        hsUrl: forceResetHsUrl,
                                        hubSession,
                                        matrixCredentials: {
                                            access_token: forceResetAccessToken,
                                            device_id: forceResetDeviceId,
                                            user_id: forceResetUserId,
                                            hs_url: forceResetHsUrl,
                                        },
                                    });
                                    setShowLanguageModal(true);
                                } catch (error) {
                                    setCompanyError(mapAuthErrorToMessage(t, error));
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
                        await updateClientLanguage(pendingLanguageContext.session, language);
                        setAuthSession({
                            userType: "client",
                            matrixCredentials: pendingLanguageContext.matrixCredentials,
                            hubSession: pendingLanguageContext.session,
                        });
                    } else {
                        await updateStaffLanguage(
                            pendingLanguageContext.accessToken,
                            pendingLanguageContext.hsUrl,
                            language,
                        );
                        setAuthSession({
                            userType: "staff",
                            matrixCredentials: pendingLanguageContext.matrixCredentials,
                            hubSession: pendingLanguageContext.hubSession,
                        });
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

function normalizeCompanyTld(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return "com";
    return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
}

type ForcePasswordResetProps = {
    accessToken: string;
    hsUrl: string;
    userId: string;
    initialPassword: string;
    onComplete: (newPassword: string) => Promise<void>;
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
    const pushToast = useToastStore((state) => state.pushToast);
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
                await onComplete(newPassword);
            } catch (error) {
                const message = mapAuthErrorToMessage(t, error);
                setError(message);
                pushToast("error", message);
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
