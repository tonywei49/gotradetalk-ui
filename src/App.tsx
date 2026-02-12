import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "./layouts/MainLayout";
import { ChatRoom } from "./features/chat";
import { AuthPage } from "./pages/AuthPage";
import { useAuthStore } from "./stores/AuthStore";
import { useThemeStore } from "./stores/ThemeStore";

export function App() {
    const isAuthenticated = useAuthStore((state) => Boolean(state.matrixCredentials));
    const userType = useAuthStore((state) => state.userType);
    const initTheme = useThemeStore((state) => state.initTheme);

    useEffect(() => {
        initTheme();
    }, [initTheme]);

    return (
        <BrowserRouter>
            <Routes>
                <Route
                    path="/auth"
                    element={
                        !isAuthenticated ? (
                            <AuthPage />
                        ) : (
                            <Navigate
                                to={userType === "staff" ? "/company/admin/dashboard" : "/app"}
                            />
                        )
                    }
                />

                <Route path="/" element={isAuthenticated ? <MainLayout /> : <Navigate to="/auth" />}>
                    <Route index element={<ChatRoom />} />
                </Route>
                <Route path="/app" element={isAuthenticated ? <MainLayout /> : <Navigate to="/auth" />}>
                    <Route index element={<ChatRoom />} />
                </Route>
                <Route
                    path="/company/admin/dashboard"
                    element={isAuthenticated ? <MainLayout /> : <Navigate to="/auth" />}
                >
                    <Route index element={<ChatRoom />} />
                </Route>
                <Route
                    path="/company/console"
                    element={isAuthenticated ? <MainLayout /> : <Navigate to="/auth" />}
                >
                    <Route index element={<ChatRoom />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
