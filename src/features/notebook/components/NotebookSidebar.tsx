import type { NotebookItem, NotebookListState } from "../types";
import type { NotebookViewFilter } from "../useNotebookModule";
import { useState } from "react";

type NotebookSidebarProps = {
    listState: NotebookListState;
    listError: string | null;
    search: string;
    onSearchChange: (value: string) => void;
    items: NotebookItem[];
    selectedItemId: string | null;
    onSelect: (itemId: string) => void;
    onCreate: () => void;
    createIsIndexable: boolean;
    onCreateIsIndexableChange: (value: boolean) => void;
    filter: NotebookViewFilter;
    onFilterChange: (value: NotebookViewFilter) => void;
    counts: { all: number; knowledge: number; note: number };
    busy: boolean;
};

function indexStateChip(status: NotebookItem["indexStatus"]): string {
    if (status === "pending") return "bg-amber-100 text-amber-700";
    if (status === "running") return "bg-sky-100 text-sky-700";
    if (status === "failed") return "bg-rose-100 text-rose-700";
    if (status === "success") return "bg-emerald-100 text-emerald-700";
    return "bg-slate-100 text-slate-600";
}

function typeChip(isIndexable: boolean): string {
    return isIndexable
        ? "bg-emerald-100 text-emerald-700"
        : "bg-slate-100 text-slate-600";
}

export function NotebookSidebar({
    listState,
    listError,
    search,
    onSearchChange,
    items,
    selectedItemId,
    onSelect,
    onCreate,
    createIsIndexable,
    onCreateIsIndexableChange,
    filter,
    onFilterChange,
    counts,
    busy,
}: NotebookSidebarProps) {
    const [showCreateTypeHelp, setShowCreateTypeHelp] = useState(false);
    return (
        <>
            <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Notebook</div>
                <button
                    type="button"
                    disabled={busy}
                    onClick={onCreate}
                    className="rounded-lg bg-[#2F5C56] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                    New
                </button>
            </div>
            <div className="p-3 border-b border-gray-100 dark:border-slate-800">
                <div className="mb-2 flex items-center gap-2 text-[11px]">
                    <button
                        type="button"
                        onClick={() => onFilterChange("all")}
                        className={`rounded-full px-2 py-1 ${filter === "all" ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
                    >
                        全部 ({counts.all})
                    </button>
                    <button
                        type="button"
                        onClick={() => onFilterChange("knowledge")}
                        className={`rounded-full px-2 py-1 ${filter === "knowledge" ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"}`}
                    >
                        知識庫 ({counts.knowledge})
                    </button>
                    <button
                        type="button"
                        onClick={() => onFilterChange("note")}
                        className={`rounded-full px-2 py-1 ${filter === "note" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
                    >
                        記事本 ({counts.note})
                    </button>
                </div>
                <input
                    type="text"
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="Search notebook"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex items-center gap-1">
                        <span className="text-slate-500 dark:text-slate-300">新增類型</span>
                        <button
                            type="button"
                            onClick={() => setShowCreateTypeHelp((prev) => !prev)}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] text-slate-500 dark:border-slate-600 dark:text-slate-300"
                        >
                            ?
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onCreateIsIndexableChange(true)}
                            className={`rounded px-2 py-1 ${createIsIndexable ? "bg-emerald-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}
                        >
                            知識庫
                        </button>
                        <button
                            type="button"
                            onClick={() => onCreateIsIndexableChange(false)}
                            className={`rounded px-2 py-1 ${!createIsIndexable ? "bg-slate-700 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}
                        >
                            記事本
                        </button>
                    </div>
                </div>
                {showCreateTypeHelp && (
                    <div className="mt-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300">
                        知識庫：會被聊天視窗 AI 功能檢索到的內容。記事本：僅保存，不做為知識庫檢索內容。
                    </div>
                )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {listState === "loading" && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        Loading notebook...
                    </div>
                )}
                {listState === "error" && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                        {listError || "Failed to load notebook."}
                    </div>
                )}
                {listState === "empty" && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        No notebook items yet.
                    </div>
                )}
                {listState === "ready" && items.length === 0 && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        目前篩選條件下沒有條目。
                    </div>
                )}
                {listState === "ready" && items.map((item) => {
                    const active = item.id === selectedItemId;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => onSelect(item.id)}
                            className={`w-full rounded-xl border p-3 text-left transition-colors ${
                                active
                                    ? "border-emerald-400 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-900/20"
                                    : "border-gray-100 bg-white hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900"
                            }`}
                        >
                            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{item.title || "Untitled"}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                                {item.contentMarkdown || "No content"}
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${typeChip(item.isIndexable)}`}>
                                        {item.isIndexable ? "知識庫" : "記事本"}
                                    </span>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${indexStateChip(item.indexStatus)}`}>
                                        {item.indexStatus}
                                    </span>
                                </div>
                                <span className="text-[10px] text-slate-400">
                                    {new Date(item.updatedAt).toLocaleString()}
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </>
    );
}
