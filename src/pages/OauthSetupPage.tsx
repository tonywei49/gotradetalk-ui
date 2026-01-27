import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { hubClientLogin, hubClientProvision, hubClientSetPassword } from "../api/hub";
import type { HubSupabaseSession } from "../api/types";
import { fetchClientLanguage, updateClientLanguage } from "../api/profile";
import { getSupabaseClient } from "../api/supabase";
import { LanguageModal } from "../components/LanguageModal";
import { translationLanguageOptions } from "../constants/translationLanguages";
import { setLanguage } from "../i18n";
import "./AuthPage.css";

const USER_ID_PATTERN = /^[a-z0-9._=-]+$/;

export function OauthSetupPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
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
    const [existingAccount, setExistingAccount] = useState(false);
    const [needsProvision, setNeedsProvision] = useState(true);
    const [showLanguageModal, setShowLanguageModal] = useState(false);
    const [pendingLanguageSession, setPendingLanguageSession] = useState<HubSupabaseSession | null>(null);

    const email = useMemo(() => session?.user?.email ?? "", [session]);

    useEffect(() => {
        const supabase = getSupabaseClient();
        void (async (): Promise<void> => {
            const { data } = await supabase.auth.getSession();
            setSession(data.session ?? null);
            if (data.session?.user?.email) {
                const localPart = data.session.user.email.split("@")[0] || "";
                setUserLocalId(localPart.toLowerCase());
            }
            setLoading(false);
        })();
    }, []);

    useEffect(() => {
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
            if (data?.matrix_user_id) {
                setExistingAccount(true);
            }
            if (data?.user_local_id) setUserLocalId(data.user_local_id);
            if (data?.company_name) setCompanyName(data.company_name);
            if (data?.country) setCountry(data.country);
            if (data?.translation_locale) setTranslationLocale(data.translation_locale);
            if (data?.job_title) setJobTitle(data.job_title);
            if (data?.gender) setGender(data.gender);
            const hasAllRequired =
                !!data?.user_local_id && !!data?.company_name && !!data?.country && !!data?.translation_locale;
            const hasPassword = !!data?.password_set;
            setNeedsProvision(!hasAllRequired || !hasPassword);
        })();
    }, [session]);

    const isValidPassword = (value: string): boolean => {
        if (value.length < 10) return false;
        return /[A-Za-z]/.test(value) && /\d/.test(value);
    };

    const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        void (async (): Promise<void> => {
            setError(null);
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
                await hubClientSetPassword(session.access_token, password);

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

                const response = await hubClientLogin(email, password, session.access_token);
                const hubSession = response.supabase ?? {
                    access_token: session.access_token,
                    refresh_token: session.refresh_token ?? "",
                    expires_at: session.expires_at ?? undefined,
                };
                const language = await fetchClientLanguage(hubSession);
                if (!language) {
                    setPendingLanguageSession(hubSession);
                    setShowLanguageModal(true);
                    return;
                }
                setLanguage(language === "zh-CN" ? "zh-CN" : "en");
                navigate("/app");
            } catch (submitError) {
                setError(submitError instanceof Error ? submitError.message : t("auth.errors.generic"));
            } finally {
                setBusy(false);
            }
        })();
    };

    if (loading) {
        return (
            <div className="gt_app">
                <main className="gt_auth">
                    <div className="gt_cardHeader">
                        <h2>{t("oauth.title")}</h2>
                        <p>{t("oauth.loading")}</p>
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
                        <h2>{t("oauth.title")}</h2>
                        <p>{t("oauth.invalid")}</p>
                    </div>
                    <div className="gt_actions">
                        <button type="button" className="gt_primary" onClick={() => navigate("/")}>
                            {t("oauth.back")}
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
                    <h2>{t("oauth.title")}</h2>
                    <p>{needsProvision ? t("oauth.subtitle") : t("oauth.loginSubtitle")}</p>
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
                    <div className="gt_actions">
                        <button type="submit" className="gt_primary" disabled={busy}>
                            {busy ? t("oauth.busy") : t("oauth.confirm")}
                        </button>
                        <button type="button" className="gt_secondary" onClick={() => navigate("/")} disabled={busy}>
                            {t("oauth.cancel")}
                        </button>
                    </div>
                </form>
            </main>
            <LanguageModal
                open={showLanguageModal}
                onSave={async (language): Promise<void> => {
                    if (!pendingLanguageSession) return;
                    await updateClientLanguage(pendingLanguageSession, language);
                    setLanguage(language);
                    setShowLanguageModal(false);
                    setPendingLanguageSession(null);
                    navigate("/app");
                }}
            />
        </div>
    );
}
