import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { BrowserRouter, Routes, Route, Navigate, useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "./stores/AuthStore";
import { useThemeStore } from "./stores/ThemeStore";
import { ToastViewport } from "./components/ToastViewport";
import { PluginHostProvider } from "./plugins";
import { useDesktopUpdater } from "./desktop/useDesktopUpdater";
import { useDesktopWindowLifecycle } from "./desktop/useDesktopWindowLifecycle";
import { isTauriDesktop, resolveRuntimePlatform } from "./runtime/appRuntime";
import type { AuthUserType } from "./stores/AuthStore";
import type { HubMatrixCredentials, HubSupabaseSession } from "./api/types";

const loadMainLayout = async () => {
    const module = await import("./layouts/MainLayout");
    return { default: module.MainLayout };
};

const loadChatRoom = async () => {
    const module = await import("./features/chat/ChatRoom");
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

type DebugAuthSession = {
    userType: AuthUserType;
    matrixCredentials: HubMatrixCredentials;
    hubSession: HubSupabaseSession | null;
};

function readDebugInjectedSession(): DebugAuthSession | null {
    const encoded = import.meta.env.VITE_DEBUG_AUTH_SESSION_B64;
    if (!encoded || typeof encoded !== "string") {
        return null;
    }

    try {
        const decoded = atob(encoded);
        const parsed = JSON.parse(decoded) as DebugAuthSession;
        if (!parsed?.userType || !parsed?.matrixCredentials?.access_token || !parsed.matrixCredentials?.user_id || !parsed.matrixCredentials?.hs_url) {
            return null;
        }
        return parsed;
    } catch (error) {
        console.warn("Failed to parse injected debug auth session:", error);
        return null;
    }
}

function RouteTransitionScreen() {
    const { t } = useTranslation();

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
                <div style={{ fontSize: "14px", fontWeight: 600 }}>{t("chat.workspaceLoading")}</div>
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

function DesktopAuthBootstrap({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}

type DesktopChatOutletContext = {
    activeRoomId: string | null;
    activeRoomName?: string | null;
    chatRouteReady?: boolean;
};

function DesktopChatIdleScreen() {
    const { t } = useTranslation();

    return (
        <div
            style={{
                minHeight: "100%",
                display: "grid",
                placeItems: "center",
                background: "linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)",
                color: "#334155",
                padding: "24px",
            }}
        >
            <div
                style={{
                    display: "grid",
                    gap: "8px",
                    justifyItems: "center",
                    textAlign: "center",
                }}
            >
                <div style={{ fontSize: "16px", fontWeight: 600 }}>{t("chat.selectConversationTitle")}</div>
                <div style={{ fontSize: "13px", color: "#64748b", maxWidth: "320px" }}>
                    {t("chat.selectConversationSubtitle")}
                </div>
            </div>
        </div>
    );
}

function DesktopChatRouteBootstrap() {
    const { activeRoomId, chatRouteReady = true } = useOutletContext<DesktopChatOutletContext>();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!activeRoomId || !chatRouteReady) {
            setReady(false);
            return undefined;
        }
        let cancelled = false;
        const activate = () => {
            if (cancelled) return;
            setReady(true);
        };
        const frame = window.requestAnimationFrame(activate);
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
        };
    }, [activeRoomId, chatRouteReady]);

    if (!activeRoomId) {
        return <DesktopChatIdleScreen />;
    }

    if (!chatRouteReady) {
        return <RouteTransitionScreen />;
    }

    if (!ready) {
        return <RouteTransitionScreen />;
    }

    return <ChatRoom />;
}

function DesktopWorkspaceBootstrap() {
    const [ready, setReady] = useState(false);
    const [LayoutComponent, setLayoutComponent] = useState<ComponentType | null>(null);

    useEffect(() => {
        let cancelled = false;
        const boot = async () => {
            if (cancelled) return;
            requestAnimationFrame(() => {
                if (cancelled) return;
                setReady(true);
            });
            window.setTimeout(async () => {
                if (cancelled) return;
                try {
                    const module = await loadMainLayout();
                    if (cancelled) return;
                    setLayoutComponent(() => module.default);
                } catch (error) {
                    console.warn("Desktop workspace layout load failed:", error);
                }
            }, 80);
        };
        const timer = window.setTimeout(() => {
            void boot();
        }, 0);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, []);

    if (!ready) {
        return <RouteTransitionScreen />;
    }

    if (!LayoutComponent) {
        return <RouteTransitionScreen />;
    }

    return <LayoutComponent />;
}

export function App() {
    const isAuthenticated = useAuthStore((state) => Boolean(state.matrixCredentials));
    const setAuthSession = useAuthStore((state) => state.setSession);
    const initTheme = useThemeStore((state) => state.initTheme);
    const isDesktop = useMemo(() => isTauriDesktop(), []);
    const isWindowsDesktop = useMemo(() => isDesktop && resolveRuntimePlatform() === "windows", [isDesktop]);
    const injectedDebugSession = useMemo(() => readDebugInjectedSession(), []);
    useDesktopUpdater();
    useDesktopWindowLifecycle();

    useEffect(() => {
        initTheme();
    }, [initTheme]);

    useEffect(() => {
        if (isAuthenticated || !injectedDebugSession) {
            return;
        }
        // Local desktop diagnostics can inject an already-validated session to skip the login form.
        setAuthSession(injectedDebugSession);
    }, [injectedDebugSession, isAuthenticated, setAuthSession]);

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
                        <Route
                            path="/auth"
                            element={
                                !isAuthenticated ? (
                                    isWindowsDesktop ? (
                                        <DesktopAuthBootstrap>
                                            <AuthPage />
                                        </DesktopAuthBootstrap>
                                    ) : (
                                        <AuthPage />
                                    )
                                ) : (
                                    <Navigate to="/app" replace />
                                )
                            }
                        />
                        <Route
                            path="/oauth"
                            element={
                                !isAuthenticated ? (
                                    isWindowsDesktop ? (
                                        <DesktopAuthBootstrap>
                                            <OauthSetupPage mode="oauth" />
                                        </DesktopAuthBootstrap>
                                    ) : (
                                        <OauthSetupPage mode="oauth" />
                                    )
                                ) : (
                                    <Navigate to="/app" replace />
                                )
                            }
                        />
                        <Route
                            path="/register/complete"
                            element={
                                !isAuthenticated ? (
                                    isWindowsDesktop ? (
                                        <DesktopAuthBootstrap>
                                            <OauthSetupPage mode="email" />
                                        </DesktopAuthBootstrap>
                                    ) : (
                                        <OauthSetupPage mode="email" />
                                    )
                                ) : (
                                    <Navigate to="/app" replace />
                                )
                            }
                        />
                        <Route path="/reset-password" element={<ResetPasswordPage />} />

                        <Route path="/app" element={isAuthenticated ? (isWindowsDesktop ? <DesktopWorkspaceBootstrap /> : <MainLayout />) : <Navigate to="/auth" replace />}>
                            <Route index element={isWindowsDesktop ? <DesktopChatRouteBootstrap /> : <ChatRoom />} />
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
