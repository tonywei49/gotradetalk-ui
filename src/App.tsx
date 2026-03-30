import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/AuthStore";
import { useThemeStore } from "./stores/ThemeStore";
import { ToastViewport } from "./components/ToastViewport";
import { PluginHostProvider } from "./plugins";
import { useDesktopUpdater } from "./desktop/useDesktopUpdater";
import { useDesktopWindowLifecycle } from "./desktop/useDesktopWindowLifecycle";
import { isTauriDesktop, resolveRuntimePlatform } from "./runtime/appRuntime";

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

function DesktopWorkspaceBootstrap() {
    const ensureMatrixClient = useAuthStore((state) => state.ensureMatrixClient);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const boot = () => {
            if (cancelled) return;
            ensureMatrixClient();
            requestAnimationFrame(() => {
                if (cancelled) return;
                setReady(true);
            });
        };
        const timer = window.setTimeout(boot, 0);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [ensureMatrixClient]);

    if (!ready) {
        return <RouteTransitionScreen />;
    }

    return <MainLayout />;
}

export function App() {
    const isAuthenticated = useAuthStore((state) => Boolean(state.matrixCredentials));
    const initTheme = useThemeStore((state) => state.initTheme);
    const isDesktop = useMemo(() => isTauriDesktop(), []);
    const isWindowsDesktop = useMemo(() => isDesktop && resolveRuntimePlatform() === "windows", [isDesktop]);
    useDesktopUpdater();
    useDesktopWindowLifecycle();

    useEffect(() => {
        initTheme();
    }, [initTheme]);

    useEffect(() => {
        if (!isAuthenticated) {
            void loadAuthPage();
            void loadOauthSetupPage();
            return;
        }

        if (!isWindowsDesktop) {
            void loadMainLayout();
            if (!isDesktop) {
                void loadChatRoom();
            }
        }
    }, [isAuthenticated, isDesktop, isWindowsDesktop]);

    return (
        <PluginHostProvider>
            <BrowserRouter>
                <Suspense fallback={<RouteTransitionScreen />}>
                    <Routes>
                        <Route path="/auth" element={!isAuthenticated ? <AuthPage /> : <Navigate to="/app" replace />} />
                        <Route path="/oauth" element={!isAuthenticated ? <OauthSetupPage /> : <Navigate to="/app" replace />} />
                        <Route path="/reset-password" element={<ResetPasswordPage />} />

                        <Route path="/app" element={isAuthenticated ? (isWindowsDesktop ? <DesktopWorkspaceBootstrap /> : <MainLayout />) : <Navigate to="/auth" replace />}>
                            <Route index element={<ChatRoom />} />
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
