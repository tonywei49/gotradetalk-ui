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
    const assetBase = env.VITE_ASSET_BASE?.trim() || "/";

    return {
        // Deep-link routes must keep resolving JS/CSS after a hard refresh in web deploys.
        base: mode === "development" ? "/" : assetBase,
        plugins: [react(), tailwindcss()],
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
