import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthPage } from "./pages/AuthPage";
import { MainPage } from "./pages/MainPage";
import { OauthSetupPage } from "./pages/OauthSetupPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { TermsPage } from "./pages/TermsPage";
import { useAuthStore } from "./stores/AuthStore";

function RequireAuth({ children }: { children: React.ReactNode }) {
    const isAuthed = useAuthStore((state) => Boolean(state.matrixCredentials));
    if (!isAuthed) {
        return <Navigate to="/" replace />;
    }
    return <>{children}</>;
}

export function App() {
    const validateSession = useAuthStore((state) => state.validateSession);

    useEffect(() => {
        void validateSession();
    }, [validateSession]);

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<AuthPage />} />
                <Route path="/oauth" element={<OauthSetupPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route
                    path="/app"
                    element={
                        <RequireAuth>
                            <MainPage />
                        </RequireAuth>
                    }
                />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/term" element={<TermsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
