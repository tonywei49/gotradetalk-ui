import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "./layouts/MainLayout";
import { ChatRoom } from "./features/chat";
import { AuthPage } from "./pages/AuthPage";
import { useAuthStore } from "./stores/AuthStore";
import { useThemeStore } from "./stores/ThemeStore";
import { ToastViewport } from "./components/ToastViewport";

export function App() {
    const isAuthenticated = useAuthStore((state) => Boolean(state.matrixCredentials));
    const initTheme = useThemeStore((state) => state.initTheme);

    useEffect(() => {
        initTheme();
    }, [initTheme]);

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/auth" element={!isAuthenticated ? <AuthPage /> : <Navigate to="/" />} />

                <Route path="/" element={isAuthenticated ? <MainLayout /> : <Navigate to="/auth" />}>
                    <Route index element={<ChatRoom />} />
                    {/* Add more routes here later */}
                </Route>
            </Routes>
            <ToastViewport />
        </BrowserRouter>
    );
}
