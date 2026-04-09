import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/AuthStore";
import { useThemeStore } from "./stores/ThemeStore";
import { ToastViewport } from "./components/ToastViewport";
import { PluginHostProvider } from "./plugins";
import { useDesktopUpdater } from "./desktop/useDesktopUpdater";
import { useDesktopWindowLifecycle } from "./desktop/useDesktopWindowLifecycle";

const loadMainLayout = async () => {
    const module = await import("./layouts/MainLayout");
    return { default: module.MainLayout };
};

const loadChatRoom = async () => {
    const module = await import("./features/chat");
    return { default: module.ChatRoom };
};

const loadAuthPage = async () => {
    const module = await import("./pages/AuthPage");
    return { default: module.AuthPage };
};

const loadOauthSetupPage = async () => {
    const module = await import("./pages/OauthSetupPage");
    return { default: module.OauthSetupPage };
};

const MainLayout = lazy(loadMainLayout);
const ChatRoom = lazy(loadChatRoom);
const AuthPage = lazy(loadAuthPage);
const OauthSetupPage = lazy(loadOauthSetupPage);

const ResetPasswordPage = lazy(async () => {
    const module = await import("./pages/ResetPasswordPage");
    return { default: module.ResetPasswordPage };
});

function RouteTransitionScreen() {
    return (
        <div
            style={{
                minHeight: "100vh",
                display: "grid",
                placeItems: "center",
                background: "linear-gradient(180deg, #f7f9fc 0%, #edf2f7 100%)",
                color: "#0f172a",
            }}
        >
            <div
                style={{
                    display: "grid",
                    justifyItems: "center",
                    gap: "12px",
                    padding: "24px",
                }}
            >
                <div
                    style={{
                        width: "56px",
                        height: "56px",
                        borderRadius: "18px",
                        background: "#0f172a",
                        color: "#ffffff",
                        display: "grid",
                        placeItems: "center",
                        fontSize: "22px",
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        boxShadow: "0 16px 32px rgba(15, 23, 42, 0.14)",
                    }}
                >
                    GT
                </div>
                <div
                    style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "999px",
                        border: "3px solid rgba(15, 23, 42, 0.14)",
                        borderTopColor: "#0f172a",
                        animation: "gt-route-spin 0.9s linear infinite",
                    }}
                />
                <div style={{ fontSize: "14px", fontWeight: 600 }}>Loading workspace...</div>
            </div>
            <style>
                {`
                    @keyframes gt-route-spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                `}
            </style>
        </div>
    );
}

export function App() {
    const isAuthenticated = useAuthStore((state) => Boolean(state.matrixCredentials));
    const initTheme = useThemeStore((state) => state.initTheme);
    useDesktopUpdater();
    useDesktopWindowLifecycle(!isAuthenticated);

    useEffect(() => {
        initTheme();
    }, [initTheme]);

    useEffect(() => {
        if (isAuthenticated) {
            void loadAuthPage();
            void loadOauthSetupPage();
            return;
        }

        void loadMainLayout();
        void loadChatRoom();
    }, [isAuthenticated]);

    return (
        <PluginHostProvider>
            <BrowserRouter>
                <Suspense fallback={<RouteTransitionScreen />}>
                    <Routes>
                        <Route path="/auth" element={!isAuthenticated ? <AuthPage /> : <Navigate to="/app" replace />} />
                        <Route path="/oauth" element={!isAuthenticated ? <OauthSetupPage mode="oauth" /> : <Navigate to="/app" replace />} />
                        <Route path="/register/complete" element={!isAuthenticated ? <OauthSetupPage mode="email" /> : <Navigate to="/app" replace />} />
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
