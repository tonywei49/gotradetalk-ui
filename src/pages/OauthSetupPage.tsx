import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { hubClientLogin, hubClientProvision, hubClientSetPassword } from "../api/hub";
import type { HubSupabaseSession } from "../api/types";
import { fetchClientLanguage, updateClientLanguage } from "../api/profile";
import { getSupabaseClient, hasSupabaseConfig, resolveSupabaseSessionFromUrl } from "../api/supabase";
import { LanguageModal } from "../components/LanguageModal";
import { isSupportedDisplayLanguage } from "../constants/displayLanguages";
import { translationLanguageOptions } from "../constants/translationLanguages";
import { setLanguage } from "../i18n/language";
import { getClientLoginSessionMetadata } from "../utils/clientSession";
import { useAuthStore } from "../stores/AuthStore";
import "./AuthPage.css";

const USER_ID_PATTERN = /^[a-z0-9._=-]+$/;

type OauthSetupPageProps = {
    mode?: "oauth" | "email";
};

export function OauthSetupPage({ mode = "oauth" }: OauthSetupPageProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const setAuthSession = useAuthStore((state) => state.setSession);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [userLocalId, setUserLocalId] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [country, setCountry] = useState("");
    const [jobTitle, setJobTitle] = useState("");
    const [gender, setGender] = useState("");
    const [translationLocale, setTranslationLocale] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [needsProvision, setNeedsProvision] = useState(true);
    const [resetBusy, setResetBusy] = useState(false);
    const [resetSuccess, setResetSuccess] = useState<string | null>(null);
    const [matrixCredentials, setMatrixCredentials] = useState<{
        access_token: string;
        device_id: string;
        user_id: string;
        hs_url: string;
    } | null>(null);
    const [showLanguageModal, setShowLanguageModal] = useState(false);
    const [pendingLanguageSession, setPendingLanguageSession] = useState<HubSupabaseSession | null>(null);
    const clientSessionMetadata = getClientLoginSessionMetadata();
    const supabaseAvailable = useMemo(() => hasSupabaseConfig(), []);
    const supabaseUnavailableMessage = "Supabase is unavailable in this desktop build.";
    const isEmailRegistrationFlow = mode === "email";

    const email = useMemo(() => session?.user?.email ?? "", [session]);
    const pageText = useMemo(() => {
        if (!isEmailRegistrationFlow) {
            return {
                title: t("oauth.title"),
                loading: t("oauth.loading"),
                invalid: t("oauth.invalid"),
                subtitle: t("oauth.subtitle"),
                loginSubtitle: t("oauth.loginSubtitle"),
                confirm: t("oauth.confirm"),
                cancel: t("oauth.cancel"),
                back: t("oauth.back"),
            };
        }

        return {
            title: t("auth.client.completeRegistrationTitle", "Complete email registration"),
            loading: t("auth.client.completeRegistrationLoading", "Preparing your verified email session..."),
            invalid: t(
                "auth.client.completeRegistrationInvalid",
                "This registration link is invalid or expired. Please request a new verification email.",
            ),
            subtitle: t(
                "auth.client.completeRegistrationSubtitle",
                "Your email is verified. Finish the remaining registration steps below.",
            ),
            loginSubtitle: t(
                "auth.client.completeRegistrationLoginSubtitle",
                "Your account exists, but setup is not finished yet. Set your password to continue.",
            ),
            confirm: t("auth.client.completeRegistrationConfirm", "Finish registration"),
            cancel: t("auth.client.completeRegistrationCancel", "Back to sign in"),
            back: t("auth.client.completeRegistrationBack", "Back to sign in"),
        };
    }, [isEmailRegistrationFlow, t]);

    useEffect(() => {
        if (!supabaseAvailable) {
            setLoading(false);
            setError(supabaseUnavailableMessage);
            return;
        }
        const supabase = getSupabaseClient();
        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            setSession(nextSession);
        });
        void (async (): Promise<void> => {
            try {
                const resolvedSession = await resolveSupabaseSessionFromUrl();
                setSession(resolvedSession);
                if (resolvedSession?.user?.email) {
                    const email = resolvedSession.user.email;
                    const localPart = email.split("@")[0] || "";
                    setUserLocalId(localPart.toLowerCase());
                } else {
                    setError(null);
                }
            } catch (resolveError) {
                setError(resolveError instanceof Error ? resolveError.message : t("auth.errors.generic"));
            } finally {
                setLoading(false);
            }
        })();
        return () => {
            data.subscription.unsubscribe();
        };
    }, [supabaseAvailable, t]);

    useEffect(() => {
        if (!supabaseAvailable) return;
        if (!session?.access_token) return;
        const supabase = getSupabaseClient();
        void (async (): Promise<void> => {
            const { data, error: profileError } = await supabase
                .from("profiles")
                .select(
                    "id, user_local_id, matrix_user_id, company_name, country, translation_locale, job_title, gender, password_set",
                )
                .eq("auth_user_id", session.user.id)
                .eq("user_type", "client")
                .maybeSingle();
            if (profileError) {
                setError(profileError.message);
                return;
            }
            const hasMatrixAccount = Boolean(data?.matrix_user_id);
            if (data?.user_local_id) setUserLocalId(data.user_local_id);
            if (data?.company_name) setCompanyName(data.company_name);
            if (data?.country) setCountry(data.country);
            if (data?.translation_locale) setTranslationLocale(data.translation_locale);
            if (data?.job_title) setJobTitle(data.job_title);
            if (data?.gender) setGender(data.gender);
            const hasAllRequired =
                !!data?.user_local_id && !!data?.company_name && !!data?.country && !!data?.translation_locale;
            const hasPassword = !!data?.password_set;
            setNeedsProvision(!hasAllRequired || !hasPassword || !hasMatrixAccount);
        })();
    }, [session, supabaseAvailable]);

    const isValidPassword = (value: string): boolean => {
        if (value.length < 10) return false;
        return /[A-Za-z]/.test(value) && /\d/.test(value);
    };

    const finalizeClientLogin = async (
        activeSession: Session,
        loginPassword: string,
        preferredLanguage?: string,
    ): Promise<void> => {
        const response = await hubClientLogin(email, loginPassword, undefined, clientSessionMetadata);
        setMatrixCredentials(response.matrix);
        const hubSession = response.supabase ?? {
            access_token: activeSession.access_token,
            refresh_token: activeSession.refresh_token ?? "",
            expires_at: activeSession.expires_at ?? undefined,
        };
        const normalizedLanguage = preferredLanguage?.trim();
        if (normalizedLanguage) {
            await updateClientLanguage(hubSession, normalizedLanguage);
            setLanguage(isSupportedDisplayLanguage(normalizedLanguage) ? normalizedLanguage : "en");
            setAuthSession({
                userType: "client",
                matrixCredentials: response.matrix,
                hubSession,
            });
            navigate("/app");
            return;
        }

        const language = await fetchClientLanguage(hubSession);
        if (!language) {
            setPendingLanguageSession(hubSession);
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
    };

    const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        void (async (): Promise<void> => {
            setError(null);
            setResetSuccess(null);
            if (!session?.access_token || !email) {
                setError(t("auth.errors.missingSupabaseSession"));
                return;
            }
            if (!password || (!confirmPassword && needsProvision)) {
                setError(t("auth.errors.emptyPassword"));
                return;
            }
            if (needsProvision) {
                if (password !== confirmPassword) {
                    setError(t("auth.errors.passwordMismatch"));
                    return;
                }
                if (!isValidPassword(password)) {
                    setError(t("auth.errors.passwordWeak"));
                    return;
                }
                const normalizedUserId = userLocalId.trim().toLowerCase();
                if (!normalizedUserId || !USER_ID_PATTERN.test(normalizedUserId)) {
                    setError(t("auth.errors.invalidUserLocalId"));
                    return;
                }
                if (!companyName.trim()) {
                    setError(t("auth.errors.missingCompanyName"));
                    return;
                }
                if (!country.trim()) {
                    setError(t("auth.errors.missingCountry"));
                    return;
                }
                if (!translationLocale.trim()) {
                    setError(t("auth.errors.missingTranslationLocale"));
                    return;
                }
            }

            setBusy(true);
            try {
                if (needsProvision) {
                    const normalizedUserId = userLocalId.trim().toLowerCase();
                    await hubClientProvision(session.access_token, {
                        user_local_id: normalizedUserId,
                        company_name: companyName.trim(),
                        country: country.trim(),
                        translation_locale: translationLocale.trim(),
                        password,
                        job_title: jobTitle.trim() || undefined,
                        gender: gender.trim() || undefined,
                    });
                }

                await hubClientSetPassword(session.access_token, password);
                await finalizeClientLogin(session, password);
            } catch (submitError) {
                setError(submitError instanceof Error ? submitError.message : t("auth.errors.generic"));
            } finally {
                setBusy(false);
            }
        })();
    };

    const onSendReset = (): void => {
        if (!isEmailRegistrationFlow) return;
        if (!email || resetBusy) return;
        void (async (): Promise<void> => {
            setResetBusy(true);
            setError(null);
            setResetSuccess(null);
            try {
                const supabase = getSupabaseClient();
                const { error: resetError } = await supabase.auth.resetPasswordForEmail(email);
                if (resetError) {
                    throw new Error(resetError.message);
                }
                setResetSuccess(t("auth.client.resetEmailSent"));
            } catch (resetError) {
                setError(resetError instanceof Error ? resetError.message : t("auth.errors.generic"));
            } finally {
                setResetBusy(false);
            }
        })();
    };

    if (loading) {
        return (
            <div className="gt_app">
                <main className="gt_auth">
                    <div className="gt_cardHeader">
                        <h2>{pageText.title}</h2>
                        <p>{pageText.loading}</p>
                    </div>
                </main>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="gt_app">
                <main className="gt_auth">
                    <div className="gt_cardHeader">
                        <h2>{pageText.title}</h2>
                        <p>{error ?? pageText.invalid}</p>
                    </div>
                    <div className="gt_actions">
                        <button type="button" className="gt_primary" onClick={() => navigate("/auth")}>
                            {pageText.back}
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="gt_app">
            <main className="gt_auth">
                <div className="gt_cardHeader">
                    <h2>{pageText.title}</h2>
                    <p>{needsProvision ? pageText.subtitle : pageText.loginSubtitle}</p>
                </div>
                <form className="gt_form" onSubmit={onSubmit}>
                    <label className="gt_field">
                        <span>{t("auth.fields.emailLabel")}</span>
                        <input type="email" value={email} readOnly />
                    </label>
                    {needsProvision && (
                        <>
                            <label className="gt_field">
                                <span>{t("auth.fields.userLocalIdLabel")}</span>
                                <input
                                    type="text"
                                    value={userLocalId}
                                    onChange={(event) => setUserLocalId(event.target.value)}
                                    placeholder={t("auth.fields.userLocalIdPlaceholder")}
                                />
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.companyNameLabel")}</span>
                                <input
                                    type="text"
                                    value={companyName}
                                    onChange={(event) => setCompanyName(event.target.value)}
                                    placeholder={t("auth.fields.companyNamePlaceholder")}
                                />
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.countryLabel")}</span>
                                <input
                                    type="text"
                                    value={country}
                                    onChange={(event) => setCountry(event.target.value)}
                                    placeholder={t("auth.fields.countryPlaceholder")}
                                />
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.jobTitleLabel")}</span>
                                <input
                                    type="text"
                                    value={jobTitle}
                                    onChange={(event) => setJobTitle(event.target.value)}
                                    placeholder={t("auth.fields.jobTitlePlaceholder")}
                                />
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.genderLabel")}</span>
                                <select value={gender} onChange={(event) => setGender(event.target.value)}>
                                    <option value="">{t("auth.fields.genderUnknown")}</option>
                                    <option value="male">{t("auth.fields.genderMale")}</option>
                                    <option value="female">{t("auth.fields.genderFemale")}</option>
                                </select>
                            </label>
                            <label className="gt_field">
                                <span>{t("auth.fields.translationLocaleLabel")}</span>
                                <select
                                    value={translationLocale}
                                    onChange={(event) => setTranslationLocale(event.target.value)}
                                >
                                    <option value="">{t("auth.fields.translationLocalePlaceholder")}</option>
                                    {translationLanguageOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </>
                    )}
                    <label className="gt_field">
                        <span>{needsProvision ? t("auth.fields.newPasswordLabel") : t("auth.fields.passwordLabel")}</span>
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="new-password"
                        />
                    </label>
                    {needsProvision && (
                        <label className="gt_field">
                            <span>{t("auth.fields.confirmPasswordLabel")}</span>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                autoComplete="new-password"
                            />
                        </label>
                    )}
                    {error && <div className="gt_error">{error}</div>}
                    {resetSuccess && <div className="gt_success">{resetSuccess}</div>}
                    <div className="gt_actions">
                        <button type="submit" className="gt_primary" disabled={busy}>
                            {busy ? t("oauth.busy") : pageText.confirm}
                        </button>
                        <button type="button" className="gt_secondary" onClick={() => navigate("/auth")} disabled={busy}>
                            {pageText.cancel}
                        </button>
                    </div>
                    {isEmailRegistrationFlow && (
                        <button type="button" className="gt_link" onClick={onSendReset} disabled={resetBusy}>
                            {resetBusy ? t("auth.client.resetBusy") : t("auth.client.forgotPassword")}
                        </button>
                    )}
                </form>
            </main>
            <LanguageModal
                open={showLanguageModal}
                onSave={async (language): Promise<void> => {
                    if (!pendingLanguageSession) return;
                    if (!matrixCredentials) {
                        throw new Error(t("auth.errors.missingSupabaseSession"));
                    }
                    await updateClientLanguage(pendingLanguageSession, language);
                    setLanguage(language);
                    setAuthSession({
                        userType: "client",
                        matrixCredentials,
                        hubSession: pendingLanguageSession,
                    });
                    setShowLanguageModal(false);
                    setPendingLanguageSession(null);
                    navigate("/app");
                }}
            />
        </div>
    );
}
