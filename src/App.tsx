import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/AuthStore";
import { useThemeStore } from "./stores/ThemeStore";
import { ToastViewport } from "./components/ToastViewport";
import { PluginHostProvider } from "./plugins";
import { useDesktopUpdater } from "./desktop/useDesktopUpdater";
import { useDesktopWindowLifecycle } from "./desktop/useDesktopWindowLifecycle";

const MainLayout = lazy(async () => {
    const module = await import("./layouts/MainLayout");
    return { default: module.MainLayout };
});

const ChatRoom = lazy(async () => {
    const module = await import("./features/chat");
    return { default: module.ChatRoom };
});

const AuthPage = lazy(async () => {
    const module = await import("./pages/AuthPage");
    return { default: module.AuthPage };
});

const OauthSetupPage = lazy(async () => {
    const module = await import("./pages/OauthSetupPage");
    return { default: module.OauthSetupPage };
});

const ResetPasswordPage = lazy(async () => {
    const module = await import("./pages/ResetPasswordPage");
    return { default: module.ResetPasswordPage };
});

export function App() {
    const isAuthenticated = useAuthStore((state) => Boolean(state.matrixCredentials));
    const initTheme = useThemeStore((state) => state.initTheme);
    useDesktopUpdater();
    useDesktopWindowLifecycle(!isAuthenticated);

    useEffect(() => {
        initTheme();
    }, [initTheme]);

    return (
        <PluginHostProvider>
            <BrowserRouter>
                <Suspense fallback={null}>
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
                </Suspense>
                <ToastViewport />
            </BrowserRouter>
        </PluginHostProvider>
    );
}
