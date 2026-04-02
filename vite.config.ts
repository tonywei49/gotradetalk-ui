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

function matchesChunk(id: string, patterns: string[]): boolean {
    return patterns.some((pattern) => id.includes(pattern));
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
            modulePreload: false,
            rollupOptions: {
                input: {
                    main: resolve(process.cwd(), "index.html"),
                    bootstrap: resolve(process.cwd(), "bootstrap.html"),
                },
                output: {
                    manualChunks(id) {
                        const notebookWorkspacePatterns = [
                            "/src/features/notebook/components/NotebookWorkspaceDesktop",
                            "/src/features/notebook/components/NotebookPanel",
                            "/src/features/notebook/components/NotebookSidebar",
                            "/src/features/notebook/components/NotebookSummaryMarkdown",
                            "/src/features/notebook/useNotebookModule",
                            "/src/features/notebook/cache",
                            "/src/features/notebook/sync",
                            "/src/features/notebook/hooks/",
                        ];
                        const notebookBridgePatterns = [
                            "/src/features/notebook/adapters/",
                            "/src/features/notebook/adapterMode",
                            "/src/features/notebook/capabilities",
                            "/src/features/notebook/constants",
                            "/src/features/notebook/notebookErrorMap",
                            "/src/features/notebook/types",
                            "/src/features/notebook/utils/",
                            "/src/services/notebook",
                        ];
                        const taskRuntimePatterns = [
                            "/src/features/tasks/hooks/useTaskModule",
                            "/src/features/tasks/taskStorage",
                            "/src/features/tasks/taskStatusConfig",
                            "/src/features/tasks/types",
                        ];
                        const taskWorkspacePatterns = [
                            "/src/features/tasks/components/TaskWorkspaceDesktop",
                            "/src/features/tasks/TaskWorkspace",
                            "/src/features/tasks/components/TaskList",
                            "/src/features/tasks/components/TaskDetail",
                            "/src/features/tasks/components/TaskReminderBanner",
                            "/src/features/tasks/taskFilters",
                        ];
                        const taskBridgePatterns = [
                            "/src/features/tasks/components/TaskQuickCreate",
                            "/src/features/tasks/components/TaskRoomBar",
                            "/src/features/tasks/hooks/useTaskUI",
                            "/src/features/tasks/statusStyles",
                        ];

                        if (id.includes("node_modules")) {
                            if (id.includes("matrix-js-sdk")) return "matrix-sdk";
                            if (id.includes("react-router")) return "router";
                            if (id.includes("react-dom") || id.includes("/react/")) return "react-vendor";
                            if (id.includes("i18next")) return "i18n-vendor";
                        }
                        if (id.includes("/src/layouts/MainLayout")) {
                            return "workspace-layout";
                        }
                        if (id.includes("/src/layouts/ChatSearchBar")) {
                            return "chat-search-bar";
                        }
                        if (id.includes("/src/layouts/NotebookPanel")) {
                            return "notebook-panel";
                        }
                        if (id.includes("/src/layouts/FileCenterPanel") || id.includes("/src/features/files/")) {
                            return "file-center";
                        }
                        if (id.includes("/src/layouts/SettingsAccountPanel")) {
                            return "settings-account";
                        }
                        if (id.includes("/src/layouts/ContactsPanel")) {
                            return "contacts-panel";
                        }
                        if (id.includes("/src/runtime/appRuntime")) {
                            return "runtime-core";
                        }
                        if (
                            id.includes("/src/stores/") ||
                            id.includes("/src/components/ToastViewport") ||
                            id.includes("/src/plugins/") ||
                            id.includes("/src/desktop/useDesktopUpdater") ||
                            id.includes("/src/desktop/useDesktopWindowLifecycle")
                        ) {
                            return "app-shell";
                        }
                        if (id.includes("/src/i18n/index") || id.includes("/src/i18n/en.json")) {
                            return "app-i18n";
                        }
                        if (id.includes("/src/constants/roomKinds") || id.includes("/src/constants/rooms")) {
                            return "room-metadata";
                        }
                        if (id.includes("/src/desktop/desktopCacheDb")) {
                            return "desktop-cache";
                        }
                        if (id.includes("/src/features/chat/chatSearchApi")) {
                            return "chat-search";
                        }
                        if (id.includes("/src/features/chat/ChatRoom") || id.includes("/src/features/chat/chatService") || id.includes("/src/features/chat/hooks/") || id.includes("/src/features/chat/translationPolicy") || id.includes("/src/features/chat/components/")) {
                            return "chat-room";
                        }
                        if (id.includes("/src/features/rooms/") || id.includes("/src/features/groups/")) {
                            return "room-list";
                        }
                        if (id.includes("/src/matrix/")) {
                            return "matrix-runtime";
                        }
                        if (matchesChunk(id, taskRuntimePatterns)) {
                            return "task-runtime";
                        }
                        if (matchesChunk(id, notebookWorkspacePatterns)) {
                            return "notebook-workspace";
                        }
                        if (matchesChunk(id, notebookBridgePatterns)) {
                            return "notebook-bridge";
                        }
                        if (matchesChunk(id, taskWorkspacePatterns)) {
                            return "task-workspace";
                        }
                        if (matchesChunk(id, taskBridgePatterns)) {
                            return "task-bridge";
                        }
                        if (id.includes("/src/features/notebook/")) {
                            return "notebook-workspace";
                        }
                        if (id.includes("/src/features/tasks/")) {
                            return "task-workspace";
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
