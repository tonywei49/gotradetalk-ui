import type { NotebookItem, NotebookListState } from "../types";

type NotebookSidebarProps = {
    listState: NotebookListState;
    listError: string | null;
    search: string;
    onSearchChange: (value: string) => void;
    items: NotebookItem[];
    selectedItemId: string | null;
    onSelect: (itemId: string) => void;
    onCreate: () => void;
    busy: boolean;
};

function indexStateChip(status: NotebookItem["indexStatus"]): string {
    if (status === "pending") return "bg-amber-100 text-amber-700";
    if (status === "running") return "bg-sky-100 text-sky-700";
    if (status === "failed") return "bg-rose-100 text-rose-700";
    if (status === "success") return "bg-emerald-100 text-emerald-700";
    return "bg-slate-100 text-slate-600";
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
    busy,
}: NotebookSidebarProps) {
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
                <input
                    type="text"
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="Search notebook"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
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
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${indexStateChip(item.indexStatus)}`}>
                                    {item.indexStatus}
                                </span>
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
