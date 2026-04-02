import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { hubClientLogin, hubClientResetPassword } from "../api/hub";
import type { HubSupabaseSession } from "../api/types";
import { fetchClientLanguage, updateClientLanguage } from "../api/profile";
import { getSupabaseClient, hasSupabaseConfig } from "../api/supabase";
import { LanguageModal } from "../components/LanguageModal";
import { isSupportedDisplayLanguage } from "../constants/displayLanguages";
import { setLanguage } from "../i18n";
import { getClientLoginSessionMetadata } from "../utils/clientSession";
import { useAuthStore } from "../stores/AuthStore";
import "./AuthPage.css";

export function ResetPasswordPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const setAuthSession = useAuthStore((state) => state.setSession);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
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

    const email = useMemo(() => session?.user?.email ?? "", [session]);

    useEffect(() => {
        if (!supabaseAvailable) {
            setLoading(false);
            setError(supabaseUnavailableMessage);
            return;
        }
        const supabase = getSupabaseClient();
        void (async (): Promise<void> => {
            const { data } = await supabase.auth.getSession();
            setSession(data.session ?? null);
            setLoading(false);
        })();
        const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            setSession(nextSession);
        });
        return () => {
            data.subscription.unsubscribe();
        };
    }, [supabaseAvailable]);

    const isValidPassword = (value: string): boolean => {
        if (value.length < 10) return false;
        return /[A-Za-z]/.test(value) && /\d/.test(value);
    };

    const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        void (async (): Promise<void> => {
            setError(null);
            setSuccess(null);
            if (!session?.access_token) {
                setError(t("auth.errors.missingSupabaseSession"));
                return;
            }
            if (!newPassword || !confirmPassword) {
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
                const supabase = getSupabaseClient();
                const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
                if (updateError) {
                    throw new Error(updateError.message);
                }
                await hubClientResetPassword(session.access_token, newPassword);
                if (!email) {
                    throw new Error(t("auth.errors.missingResetEmail"));
                }
                const response = await hubClientLogin(email, newPassword, session.access_token, clientSessionMetadata);
                setMatrixCredentials(response.matrix);
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
                setLanguage(isSupportedDisplayLanguage(language) ? language : "en");
                setAuthSession({
                    userType: "client",
                    matrixCredentials: response.matrix,
                    hubSession,
                });
                setSuccess(t("auth.client.resetSuccess"));
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
                        <h2>{t("auth.client.resetTitle")}</h2>
                        <p>{t("auth.client.resetLoading")}</p>
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
                        <h2>{t("auth.client.resetTitle")}</h2>
                        <p>{error ?? t("auth.client.resetInvalid")}</p>
                    </div>
                    <div className="gt_actions">
                        <button type="button" className="gt_primary" onClick={() => navigate("/")}>
                            {t("auth.client.resetBack")}
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
                    <h2>{t("auth.client.resetTitle")}</h2>
                    <p>{t("auth.client.resetSubtitle")}</p>
                </div>
                <form className="gt_form" onSubmit={onSubmit}>
                    <label className="gt_field">
                        <span>{t("auth.fields.emailLabel")}</span>
                        <input type="email" value={email} readOnly />
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
                    {success && <div className="gt_success">{success}</div>}
                    <div className="gt_actions">
                        <button type="submit" className="gt_primary" disabled={busy}>
                            {busy ? t("auth.client.resetBusy") : t("auth.client.resetConfirm")}
                        </button>
                        <button type="button" className="gt_secondary" onClick={() => navigate("/")} disabled={busy}>
                            {t("auth.client.resetCancel")}
                        </button>
                    </div>
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
