import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "./layouts/MainLayout";
import { ChatRoom } from "./features/chat";
import { AuthPage } from "./pages/AuthPage";
import { OauthSetupPage } from "./pages/OauthSetupPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { useAuthStore } from "./stores/AuthStore";
import { useThemeStore } from "./stores/ThemeStore";
import { ToastViewport } from "./components/ToastViewport";
import { PluginHostProvider } from "./plugins";

export function App() {
    const isAuthenticated = useAuthStore((state) => Boolean(state.matrixCredentials));
    const initTheme = useThemeStore((state) => state.initTheme);

    useEffect(() => {
        initTheme();
    }, [initTheme]);

    return (
        <PluginHostProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/auth" element={!isAuthenticated ? <AuthPage /> : <Navigate to="/app" replace />} />
                    <Route path="/oauth" element={!isAuthenticated ? <OauthSetupPage /> : <Navigate to="/app" replace />} />
                    <Route path="/reset-password" element={<ResetPasswordPage />} />

                    <Route path="/app" element={isAuthenticated ? <MainLayout /> : <Navigate to="/auth" replace />}>
                        <Route index element={<ChatRoom />} />
                        {/* Add more routes here later */}
                    </Route>

                    <Route path="/" element={<Navigate to={isAuthenticated ? "/app" : "/auth"} replace />} />
                    <Route path="*" element={<Navigate to={isAuthenticated ? "/app" : "/auth"} replace />} />
                </Routes>
                <ToastViewport />
            </BrowserRouter>
        </PluginHostProvider>
    );
}
