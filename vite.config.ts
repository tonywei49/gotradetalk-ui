import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            "/api": {
                target: "https://api.gotradetalk.com",
                changeOrigin: true,
                secure: true,
                configure: (proxy) => {
                    proxy.on("proxyReq", (proxyReq) => {
                        proxyReq.setHeader("origin", "https://api.gotradetalk.com");
                    });
                },
            },
        },
    },
});
