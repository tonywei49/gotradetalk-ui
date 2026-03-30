import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

function resolveProxyTarget(value: string | undefined, fallback: string): string {
    if (value && /^https?:\/\//i.test(value)) {
        return normalizeBaseUrl(value);
    }
    return normalizeBaseUrl(fallback);
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const hubTarget = resolveProxyTarget(env.VITE_HUB_API_BASE_URL, "https://api.gotradetalk.com");
    const notebookTarget = resolveProxyTarget(env.VITE_NOTEBOOK_API_BASE_URL, hubTarget);

    return {
        base: mode === "development" ? "/" : "./",
        plugins: [react(), tailwindcss()],
        build: {
            modulePreload: {
                resolveDependencies(_filename, deps, context) {
                    if (context.hostType === "html" && context.hostId.endsWith("bootstrap.html")) {
                        return [];
                    }
                    return deps;
                },
            },
            rollupOptions: {
                input: {
                    main: resolve(process.cwd(), "index.html"),
                    bootstrap: resolve(process.cwd(), "bootstrap.html"),
                },
                output: {
                    manualChunks(id) {
                        if (id.includes("node_modules")) {
                            if (id.includes("matrix-js-sdk")) return "matrix-sdk";
                            if (id.includes("react-router")) return "router";
                            if (id.includes("react-dom") || id.includes("/react/")) return "react-vendor";
                            if (id.includes("i18next")) return "i18n-vendor";
                        }
                        if (id.includes("/src/layouts/MainLayout") || id.includes("/src/features/chat/") || id.includes("/src/features/rooms/") || id.includes("/src/matrix/")) {
                            return "chat-runtime";
                        }
                        if (id.includes("/src/features/notebook/") || id.includes("/src/services/notebook")) {
                            return "notebook-runtime";
                        }
                        if (id.includes("/src/features/tasks/")) {
                            return "task-runtime";
                        }
                        return undefined;
                    },
                },
            },
        },
        server: {
            strictPort: true,
            proxy: {
                "/api": {
                    target: hubTarget,
                    changeOrigin: true,
                    secure: true,
                    rewrite: (path) => path.replace(/^\/api/, ""),
                    configure: (proxy) => {
                        proxy.on("proxyReq", (proxyReq) => {
                            proxyReq.removeHeader("origin");
                        });
                    },
                },
                "/notebook-api": {
                    target: notebookTarget,
                    changeOrigin: true,
                    secure: true,
                    rewrite: (path) => path.replace(/^\/notebook-api/, ""),
                    configure: (proxy) => {
                        proxy.on("proxyReq", (proxyReq) => {
                            proxyReq.removeHeader("origin");
                        });
                    },
                },
            },
        },
    };
});
