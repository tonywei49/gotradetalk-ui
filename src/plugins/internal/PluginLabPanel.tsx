import { useState } from "react";
import type { PluginHostTools, PluginPlatformState, PluginRuntimeContext } from "../types";

export function PluginLabPanel({
    context,
    platformState,
    tools,
}: {
    context: PluginRuntimeContext;
    platformState: PluginPlatformState;
    tools: PluginHostTools;
}) {
    const [configBusy, setConfigBusy] = useState(false);
    const [tokenBusy, setTokenBusy] = useState(false);
    const [configValue, setConfigValue] = useState<string>("-");
    const [tokenPreview, setTokenPreview] = useState<string>("-");
    const [quotaUsed, setQuotaUsed] = useState<string>("-");
    const [actionError, setActionError] = useState<string | null>(null);

    const handleLoadConfig = async () => {
        setConfigBusy(true);
        setActionError(null);
        try {
            const config = await tools.getPluginConfig("plugin-lab");
            const usage = await tools.reportPluginUsage("plugin-lab", {
                action: "read_config",
                status: "success",
                requestId: `plugin-lab-config-${Date.now()}`,
                meta: { source: "plugin-lab-panel" },
            });
            setConfigValue(JSON.stringify(config ?? {}, null, 2));
            setQuotaUsed(String(usage.quotaUsed ?? "-"));
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to load plugin config.");
        } finally {
            setConfigBusy(false);
        }
    };

    const handleIssueToken = async () => {
        setTokenBusy(true);
        setActionError(null);
        try {
            const token = await tools.issuePluginToken("plugin-lab", ["plugin:read_config"]);
            const usage = await tools.reportPluginUsage("plugin-lab", {
                action: "invoke",
                status: "success",
                requestId: `plugin-lab-token-${Date.now()}`,
                meta: { scope: ["plugin:read_config"] },
            });
            const preview = token.token.length > 36 ? `${token.token.slice(0, 18)}...${token.token.slice(-12)}` : token.token;
            setTokenPreview(`${preview}${token.expiresAt ? `\nexpires_at: ${token.expiresAt}` : ""}`);
            setQuotaUsed(String(usage.quotaUsed ?? "-"));
        } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to issue plugin token.");
        } finally {
            setTokenBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100">
                这是第一版内建插件样板。后续平台端把插件授权和配置接上后，这里可以替换成真正的插件页面。
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">平台同步状态</div>
                <dl className="grid grid-cols-1 gap-3 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                    <div>
                        <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Source</dt>
                        <dd>{platformState.source}</dd>
                    </div>
                    <div>
                        <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Sync State</dt>
                        <dd>{platformState.syncState}</dd>
                    </div>
                    <div className="sm:col-span-2">
                        <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Error</dt>
                        <dd>{platformState.errorMessage ?? "-"}</dd>
                    </div>
                </dl>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">当前宿主上下文</div>
                <dl className="grid grid-cols-1 gap-3 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                    <div>
                        <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">User Type</dt>
                        <dd>{context.userType ?? "unknown"}</dd>
                    </div>
                    <div>
                        <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Matrix User</dt>
                        <dd>{context.matrixUserLocalId ?? "-"}</dd>
                    </div>
                    <div>
                        <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Home Server</dt>
                        <dd className="break-all">{context.matrixHomeServer ?? "-"}</dd>
                    </div>
                    <div>
                        <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Hub Session</dt>
                        <dd>{context.hasHubSession ? "available" : "missing"}</dd>
                    </div>
                </dl>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">平台能力测试</div>
                <div className="flex flex-wrap gap-3">
                    <button
                        type="button"
                        onClick={() => void handleLoadConfig()}
                        disabled={configBusy}
                        className="rounded-lg bg-[#2F5C56] px-4 py-2 text-sm font-semibold text-white hover:bg-[#244a45] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {configBusy ? "Loading config..." : "Load plugin config"}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleIssueToken()}
                        disabled={tokenBusy}
                        className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                    >
                        {tokenBusy ? "Issuing token..." : "Issue plugin token"}
                    </button>
                </div>
                {actionError && (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
                        {actionError}
                    </div>
                )}
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Config
                        </div>
                        <pre className="min-h-24 overflow-auto rounded-xl bg-slate-950 px-3 py-3 text-xs text-slate-100">{configValue}</pre>
                    </div>
                    <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Token Preview
                        </div>
                        <pre className="min-h-24 overflow-auto rounded-xl bg-slate-950 px-3 py-3 text-xs text-slate-100 whitespace-pre-wrap break-all">{tokenPreview}</pre>
                    </div>
                </div>
                <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                    quota_used: {quotaUsed}
                </div>
            </div>
        </div>
    );
}
