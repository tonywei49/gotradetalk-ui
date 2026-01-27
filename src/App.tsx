import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthPage } from "./pages/AuthPage";
import { MainPage } from "./pages/MainPage";

export function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<AuthPage />} />
                <Route path="/app" element={<MainPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
