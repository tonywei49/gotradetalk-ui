import { useState } from "react";
import type { NotebookItem, NotebookListState } from "../types";
import type { NotebookSourceScope, NotebookViewFilter } from "../useNotebookModule";
import { useTranslation } from "react-i18next";

type NotebookQuickFilter = "allSources" | "knowledge" | "note" | "company";
type NotebookSidebarMode = "notebook" | "chatSummary";

export type SummarySearchTarget = {
    type: "room" | "person";
    id: string;
    label: string;
};

export type SummarySearchPersonItem = {
    id: string;
    label: string;
    meta?: string | null;
};

export type SummarySearchRoomItem = {
    id: string;
    label: string;
    meta?: string | null;
};

type NotebookSidebarProps = {
    listState: NotebookListState;
    listError: string | null;
    search: string;
    onSearchChange: (value: string) => void;
    items: NotebookItem[];
    selectedItemId: string | null;
    onSelect: (itemId: string) => void;
    onCreate: () => void;
    filter: NotebookViewFilter;
    onFilterChange: (value: NotebookViewFilter) => void;
    sourceScope: NotebookSourceScope;
    onSourceScopeChange: (value: NotebookSourceScope) => void;
    busy: boolean;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    showCompanyFilter?: boolean;
    mode: NotebookSidebarMode;
    onModeChange: (value: NotebookSidebarMode) => void;
    summaryQuery: string;
    onSummaryQueryChange: (value: string) => void;
    onSummarySearchNow: (value: string) => void;
    summaryLoading: boolean;
    summaryError: string | null;
    summaryPeopleResults: SummarySearchPersonItem[];
    summaryRoomResults: SummarySearchRoomItem[];
    summarySelectedTarget: SummarySearchTarget | null;
    onSummarySelectTarget: (target: SummarySearchTarget) => void;
};

function indexStateChip(status: NotebookItem["indexStatus"]): string {
    if (status === "pending") return "bg-amber-100 text-amber-700";
    if (status === "running") return "bg-sky-100 text-sky-700";
    if (status === "failed") return "bg-rose-100 text-rose-700";
    if (status === "success") return "bg-emerald-100 text-emerald-700";
    return "bg-slate-100 text-slate-600";
}

function typeChip(isIndexable: boolean): string {
    return isIndexable ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600";
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
    filter,
    onFilterChange,
    sourceScope,
    onSourceScopeChange,
    busy,
    hasMore,
    loadingMore,
    onLoadMore,
    showCompanyFilter = true,
    mode,
    onModeChange,
    summaryQuery,
    onSummaryQueryChange,
    onSummarySearchNow,
    summaryLoading,
    summaryError,
    summaryPeopleResults,
    summaryRoomResults,
    summarySelectedTarget,
    onSummarySelectTarget,
}: NotebookSidebarProps) {
    const { t } = useTranslation();
    const [summaryStartDate, setSummaryStartDate] = useState("");
    const [summaryEndDate, setSummaryEndDate] = useState("");
    const quickFilter: NotebookQuickFilter = showCompanyFilter && sourceScope === "company"
        ? "company"
        : filter === "knowledge"
            ? "knowledge"
            : filter === "note"
                ? "note"
                : "allSources";
    const hasSummaryResults = summaryPeopleResults.length > 0 || summaryRoomResults.length > 0;
    const hasInvalidDateRange = Boolean(summaryStartDate && summaryEndDate && summaryStartDate > summaryEndDate);

    const applyQuickFilter = (next: NotebookQuickFilter): void => {
        if (next === "allSources") {
            onSourceScopeChange("both");
            onFilterChange("all");
            return;
        }
        if (next === "knowledge") {
            onSourceScopeChange("personal");
            onFilterChange("knowledge");
            return;
        }
        if (next === "note") {
            onSourceScopeChange("personal");
            onFilterChange("note");
            return;
        }
        onSourceScopeChange("company");
        onFilterChange("all");
    };

    return (
        <>
            <div className="h-16 px-4 flex items-center border-b border-gray-100 dark:border-slate-800">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {t("layout.notebook.sidebarTitle", "Notebook")}
                </div>
            </div>
            <div className="p-3 border-b border-gray-100 dark:border-slate-800">
                <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
                    <button
                        type="button"
                        onClick={() => onModeChange("notebook")}
                        className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                            mode === "notebook"
                                ? "bg-[#2F5C56] text-white dark:bg-emerald-500"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                    >
                        {t("layout.notebook.tabNotebook", "Notebook")}
                    </button>
                    <button
                        type="button"
                        onClick={() => onModeChange("chatSummary")}
                        className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                            mode === "chatSummary"
                                ? "bg-[#2F5C56] text-white dark:bg-emerald-500"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                    >
                        {t("layout.notebook.tabAiChatSummary", "AI Chat Summary")}
                    </button>
                </div>
                {mode === "notebook" && (
                    <>
                        <div className="mb-2 flex items-center gap-2 text-[11px]">
                            <button
                                type="button"
                                onClick={() => applyQuickFilter("allSources")}
                                className={`rounded-full px-2 py-1 ${quickFilter === "allSources" ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
                            >
                                全部來源
                            </button>
                            <button
                                type="button"
                                onClick={() => applyQuickFilter("knowledge")}
                                className={`rounded-full px-2 py-1 ${quickFilter === "knowledge" ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"}`}
                            >
                                知識庫
                            </button>
                            <button
                                type="button"
                                onClick={() => applyQuickFilter("note")}
                                className={`rounded-full px-2 py-1 ${quickFilter === "note" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
                            >
                                記事本
                            </button>
                            {showCompanyFilter && (
                                <button
                                    type="button"
                                    onClick={() => applyQuickFilter("company")}
                                    className={`rounded-full px-2 py-1 ${quickFilter === "company" ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"}`}
                                >
                                    公司資料
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={search}
                                onChange={(event) => onSearchChange(event.target.value)}
                                placeholder={t("layout.notebook.searchNotebookPlaceholder", "Search notebook")}
                                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                            <button
                                type="button"
                                disabled={busy || sourceScope === "company"}
                                onClick={onCreate}
                                className="shrink-0 rounded-lg bg-[#2F5C56] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                New
                            </button>
                        </div>
                    </>
                )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar p-3 space-y-2">
                {mode === "chatSummary" && (
                    <div className="space-y-3">
                        <label className="block">
                            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                                {t("layout.notebook.summarySearchLabel", "Search")}
                            </div>
                            <input
                                type="text"
                                value={summaryQuery}
                                onChange={(event) => onSummaryQueryChange(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        onSummarySearchNow(summaryQuery);
                                    }
                                }}
                                placeholder={t("layout.notebook.summarySearchPlaceholder", "Search by person name or room name")}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                        </label>
                        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
                                {t("layout.notebook.summaryResultTitle", "Matched chat rooms / people")}
                            </div>
                            {summaryLoading && (
                                <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                                    {t("layout.notebook.summarySearching", "Searching...")}
                                </div>
                            )}
                            {summaryError && (
                                <div className="mb-2 text-xs text-rose-500">{summaryError}</div>
                            )}
                            <div className="max-h-60 overflow-y-auto space-y-2">
                                {!summaryLoading && !summaryError && !hasSummaryResults ? (
                                    <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                        {t("layout.notebook.summaryResultEmpty", "No matched result.")}
                                    </div>
                                ) : null}
                                {summaryPeopleResults.length > 0 ? (
                                    <div>
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                                            {t("layout.notebook.summaryTypePerson", "Person")}
                                        </div>
                                        <div className="space-y-1">
                                            {summaryPeopleResults.map((item) => {
                                                const active = summarySelectedTarget?.type === "person" && summarySelectedTarget.id === item.id;
                                                return (
                                                    <button
                                                        key={`person-${item.id}`}
                                                        type="button"
                                                        onClick={() => onSummarySelectTarget({ type: "person", id: item.id, label: item.label })}
                                                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                                                            active
                                                                ? "border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-900/30 dark:text-emerald-100"
                                                                : "border-gray-200 bg-white text-slate-700 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                                        }`}
                                                    >
                                                        <div className="truncate text-sm font-semibold">{item.label}</div>
                                                        {item.meta ? (
                                                            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{item.meta}</div>
                                                        ) : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : null}
                                {summaryRoomResults.length > 0 ? (
                                    <div>
                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                                            {t("layout.notebook.summaryTypeRoom", "Room")}
                                        </div>
                                        <div className="space-y-1">
                                            {summaryRoomResults.map((item) => {
                                                const active = summarySelectedTarget?.type === "room" && summarySelectedTarget.id === item.id;
                                                return (
                                                    <button
                                                        key={`room-${item.id}`}
                                                        type="button"
                                                        onClick={() => onSummarySelectTarget({ type: "room", id: item.id, label: item.label })}
                                                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                                                            active
                                                                ? "border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-900/30 dark:text-emerald-100"
                                                                : "border-gray-200 bg-white text-slate-700 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                                        }`}
                                                    >
                                                        <div className="truncate text-sm font-semibold">{item.label}</div>
                                                        {item.meta ? (
                                                            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{item.meta}</div>
                                                        ) : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            <label className="block">
                                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                                    {t("layout.notebook.summaryStartDate", "Start date")}
                                </div>
                                <input
                                    type="date"
                                    value={summaryStartDate}
                                    onChange={(event) => setSummaryStartDate(event.target.value)}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                            </label>
                            <label className="block">
                                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                                    {t("layout.notebook.summaryEndDate", "End date")}
                                </div>
                                <input
                                    type="date"
                                    value={summaryEndDate}
                                    onChange={(event) => setSummaryEndDate(event.target.value)}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                            </label>
                        </div>
                        {hasInvalidDateRange && (
                            <div className="text-xs text-rose-500">
                                {t("layout.notebook.summaryDateRangeInvalid", "Start date must be earlier than or equal to end date.")}
                            </div>
                        )}
                        <button
                            type="button"
                            disabled={!summarySelectedTarget || !summaryStartDate || !summaryEndDate || hasInvalidDateRange}
                            onClick={() => {
                                // Placeholder only: summary task implementation is out of scope.
                                console.info("[AI Summary Placeholder]", {
                                    target: summarySelectedTarget,
                                    startDate: summaryStartDate,
                                    endDate: summaryEndDate,
                                });
                            }}
                            className="inline-flex items-center justify-center rounded-xl bg-[#2F5C56] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500"
                        >
                            {t("layout.notebook.summaryConfirm", "Confirm")}
                        </button>
                    </div>
                )}
                {mode === "notebook" && listState === "loading" && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        {t("layout.notebook.loadingItems", "Loading notebook...")}
                    </div>
                )}
                {mode === "notebook" && listState === "error" && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                        {listError || t("layout.notebook.loadItemsFailed", "Failed to load notebook.")}
                    </div>
                )}
                {mode === "notebook" && listState === "empty" && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        {t("layout.notebook.emptyItems", "No notebook items yet.")}
                    </div>
                )}
                {mode === "notebook" && listState === "ready" && items.length === 0 && (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        {t("layout.notebook.filteredEmpty", "No items under the current filter.")}
                    </div>
                )}
                {mode === "notebook" && listState === "ready" && items.map((item) => {
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
                            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {item.title || t("layout.notebook.untitled", "Untitled")}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                                {item.contentMarkdown || t("layout.notebook.noContent", "No content")}
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${item.sourceScope === "company" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>
                                        {item.sourceScope === "company" ? "公司資料" : "個人"}
                                    </span>
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
                {mode === "notebook" && listState === "ready" && hasMore && (
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={loadingMore}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                        {loadingMore
                            ? t("layout.notebook.loadingMore", "Loading...")
                            : t("layout.notebook.loadMore", "Load more")}
                    </button>
                )}
            </div>
        </>
    );
}
