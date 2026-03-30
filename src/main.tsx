import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import "./i18n";
import "./index.css";
import { App } from "./App";
import { installDesktopHttpBridge } from "./desktop/installDesktopHttpBridge";

const root = document.getElementById("root");

if (!root) {
    throw new Error("Root element not found");
}

installDesktopHttpBridge();

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
