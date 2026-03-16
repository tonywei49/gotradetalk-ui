import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./index.css";
import { App } from "./App";
import { installDesktopHttpBridge } from "./desktop/installDesktopHttpBridge";
import { hubApiBaseUrl, notebookApiBaseUrl } from "./config";
import { isTauriRuntime } from "./runtime/appRuntime";

type RootErrorBoundaryState = {
    error: Error | null;
    stack: string | null;
};

class RootErrorBoundary extends Component<{ children: ReactNode }, RootErrorBoundaryState> {
    override state: RootErrorBoundaryState = {
        error: null,
        stack: null,
    };

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("Root render failed", error, info);
        this.setState({
            error,
            stack: info.componentStack || error.stack || null,
        });
    }

    override render(): ReactNode {
        if (!this.state.error) return this.props.children;

        return (
            <div
                style={{
                    minHeight: "100dvh",
                    display: "grid",
                    placeItems: "center",
                    padding: "24px",
                    background: "#fff7ed",
                    color: "#7c2d12",
                    fontFamily: "\"Avenir Next\", \"PingFang SC\", sans-serif",
                }}
            >
                <div
                    style={{
                        width: "min(720px, 100%)",
                        borderRadius: "24px",
                        border: "1px solid rgba(194, 65, 12, 0.18)",
                        background: "#ffffff",
                        boxShadow: "0 18px 48px rgba(124, 45, 18, 0.12)",
                        padding: "20px",
                    }}
                >
                    <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#c2410c" }}>
                        GoTradeTalk
                    </div>
                    <h1 style={{ margin: "10px 0 8px", fontSize: "20px", lineHeight: 1.2 }}>
                        Frontend runtime error
                    </h1>
                    <p style={{ margin: 0, fontSize: "14px", color: "#9a3412" }}>
                        The app shell started, but React failed while rendering.
                    </p>
                    <pre
                        style={{
                            margin: "16px 0 0",
                            maxHeight: "50dvh",
                            overflow: "auto",
                            borderRadius: "16px",
                            background: "#431407",
                            color: "#fed7aa",
                            padding: "14px",
                            fontSize: "12px",
                            lineHeight: 1.45,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                        }}
                    >
                        {this.state.error.message}
                        {this.state.stack ? `\n\n${this.state.stack}` : ""}
                    </pre>
                </div>
            </div>
        );
    }
}

installDesktopHttpBridge();

if (isTauriRuntime()) {
    console.info("GoTradeTalk runtime API config", {
        hubApiBaseUrl,
        notebookApiBaseUrl,
    });
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <RootErrorBoundary>
            <App />
        </RootErrorBoundary>
    </StrictMode>,
);
