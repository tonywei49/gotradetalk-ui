import { useMemo, useState, type ReactNode } from "react";
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

export type SummaryDirectionPayload = {
    summaryDirection: string;
    summaryCustomRequirement: string | null;
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
    onManualSync: () => void;
    filter: NotebookViewFilter;
    onFilterChange: (value: NotebookViewFilter) => void;
    sourceScope: NotebookSourceScope;
    onSourceScopeChange: (value: NotebookSourceScope) => void;
    busy: boolean;
    listRefreshing?: boolean;
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
    summaryStartDate: string;
    summaryEndDate: string;
    onSummaryStartDateChange: (value: string) => void;
    onSummaryEndDateChange: (value: string) => void;
    onSummaryConfirm: (payload: SummaryDirectionPayload) => void;
    summaryConfirmLoading?: boolean;
    summaryConfirmHint?: string | null;
    summaryMobilePanel?: ReactNode;
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
    onManualSync,
    filter,
    onFilterChange,
    sourceScope,
    onSourceScopeChange,
    busy,
    listRefreshing = false,
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
    summaryStartDate,
    summaryEndDate,
    onSummaryStartDateChange,
    onSummaryEndDateChange,
    onSummaryConfirm,
    summaryConfirmLoading = false,
    summaryConfirmHint = null,
    summaryMobilePanel,
}: NotebookSidebarProps) {
    const { t } = useTranslation();
    const quickFilter: NotebookQuickFilter = showCompanyFilter && sourceScope === "company"
        ? "company"
        : filter === "knowledge"
            ? "knowledge"
            : filter === "note"
                ? "note"
                : "allSources";
    void summaryPeopleResults;
    const hasSummaryResults = summaryRoomResults.length > 0;
    const hasInvalidDateRange = Boolean(summaryStartDate && summaryEndDate && summaryStartDate > summaryEndDate);
    const [pickerTarget, setPickerTarget] = useState<"start" | "end" | null>(null);
    const [pickerYear, setPickerYear] = useState<number>(new Date().getFullYear());
    const [pickerMonth, setPickerMonth] = useState<number>(new Date().getMonth() + 1);
    const [pickerDay, setPickerDay] = useState<number>(new Date().getDate());
    const [pickerHour, setPickerHour] = useState<number>(new Date().getHours());
    const [summaryDirection, setSummaryDirection] = useState<string>("meetingMinutes");
    const [summaryCustomRequirement, setSummaryCustomRequirement] = useState<string>("");
    const hasSummaryRangeExceeded = (() => {
        if (!summaryStartDate || !summaryEndDate) return false;
        const start = new Date(summaryStartDate).getTime();
        const end = new Date(summaryEndDate).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
        return end - start > 72 * 60 * 60 * 1000;
    })();
    const normalizeToHour = (value: string): string => {
        const trimmed = String(value || "").trim();
        if (!trimmed) return "";
        const parsed = new Date(trimmed);
        if (Number.isNaN(parsed.getTime())) return "";
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, "0");
        const day = String(parsed.getDate()).padStart(2, "0");
        const hour = String(parsed.getHours()).padStart(2, "0");
        return `${year}-${month}-${day}T${hour}:00`;
    };
    const parseDateTimeValue = (value: string): { year: number; month: number; day: number; hour: number } | null => {
        const normalized = normalizeToHour(value);
        if (!normalized) return null;
        const [datePart, timePart] = normalized.split("T");
        if (!datePart || !timePart) return null;
        const [yearText, monthText, dayText] = datePart.split("-");
        const hourText = timePart.slice(0, 2);
        const year = Number(yearText);
        const month = Number(monthText);
        const day = Number(dayText);
        const hour = Number(hourText);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(hour)) return null;
        return { year, month, day, hour };
    };
    const formatSummaryDateTime = (value: string): string => {
        const parsed = parseDateTimeValue(value);
        if (!parsed) return t("layout.notebook.summaryDateTimePlaceholder", "Tap to pick date/time");
        const year = String(parsed.year);
        const month = String(parsed.month).padStart(2, "0");
        const day = String(parsed.day).padStart(2, "0");
        const hour = String(parsed.hour).padStart(2, "0");
        return `${year}/${month}/${day} ${hour}:00`;
    };
    const daysInMonth = (year: number, month: number): number => {
        return new Date(year, month, 0).getDate();
    };
    const pickerYears = useMemo(() => {
        const currentYear = new Date().getFullYear();
        return Array.from({ length: 7 }, (_, index) => currentYear - 2 + index);
    }, []);
    const summaryDirectionOptions = useMemo(
        () => ([
            { value: "meetingMinutes", label: t("layout.notebook.summaryDirectionMeetingMinutes", "General meeting minutes") },
            { value: "quotationSummary", label: t("layout.notebook.summaryDirectionQuotation", "Quotation summary") },
            { value: "complaintNegotiation", label: t("layout.notebook.summaryDirectionComplaint", "Customer complaint negotiation") },
            { value: "productDevelopment", label: t("layout.notebook.summaryDirectionProduct", "Product development") },
            { value: "orderFollowUp", label: t("layout.notebook.summaryDirectionOrder", "Order follow-up") },
            { value: "supplierCoordination", label: t("layout.notebook.summaryDirectionSupplier", "Supplier coordination") },
            { value: "logisticsShipment", label: t("layout.notebook.summaryDirectionLogistics", "Logistics and shipment") },
            { value: "paymentCollection", label: t("layout.notebook.summaryDirectionPayment", "Payment and collection") },
            { value: "contractTerms", label: t("layout.notebook.summaryDirectionContract", "Contract terms") },
            { value: "riskCompliance", label: t("layout.notebook.summaryDirectionRisk", "Risk and compliance") },
            { value: "custom", label: t("layout.notebook.summaryDirectionCustom", "Custom") },
        ]),
        [t],
    );
    const pickerMonths = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
    const pickerHours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
    const pickerDays = useMemo(
        () => Array.from({ length: daysInMonth(pickerYear, pickerMonth) }, (_, i) => i + 1),
        [pickerYear, pickerMonth],
    );
    const openPicker = (target: "start" | "end"): void => {
        const source = target === "start" ? summaryStartDate : summaryEndDate;
        const parsed = parseDateTimeValue(source);
        const base = parsed ?? (() => {
            const now = new Date();
            return {
                year: now.getFullYear(),
                month: now.getMonth() + 1,
                day: now.getDate(),
                hour: now.getHours(),
            };
        })();
        setPickerYear(base.year);
        setPickerMonth(base.month);
        setPickerDay(base.day);
        setPickerHour(base.hour);
        setPickerTarget(target);
    };
    const confirmPicker = (): void => {
        if (!pickerTarget) return;
        const safeDay = Math.min(pickerDay, daysInMonth(pickerYear, pickerMonth));
        const year = String(pickerYear).padStart(4, "0");
        const month = String(pickerMonth).padStart(2, "0");
        const day = String(safeDay).padStart(2, "0");
        const hour = String(pickerHour).padStart(2, "0");
        const value = `${year}-${month}-${day}T${hour}:00`;
        if (pickerTarget === "start") {
            onSummaryStartDateChange(value);
        } else {
            onSummaryEndDateChange(value);
        }
        setPickerTarget(null);
    };

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
                                {t("layout.notebook.filterAllSources", "All sources")}
                            </button>
                            <button
                                type="button"
                                onClick={() => applyQuickFilter("knowledge")}
                                className={`rounded-full px-2 py-1 ${quickFilter === "knowledge" ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"}`}
                            >
                                {t("layout.notebook.filterKnowledge", "Knowledge")}
                            </button>
                            <button
                                type="button"
                                onClick={() => applyQuickFilter("note")}
                                className={`rounded-full px-2 py-1 ${quickFilter === "note" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
                            >
                                {t("layout.notebook.filterNote", "Note")}
                            </button>
                            {showCompanyFilter && (
                                <button
                                    type="button"
                                    onClick={() => applyQuickFilter("company")}
                                    className={`rounded-full px-2 py-1 ${quickFilter === "company" ? "bg-indigo-600 text-white" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"}`}
                                >
                                    {t("layout.notebook.filterCompany", "Company")}
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
                                disabled={busy || listRefreshing}
                                onClick={onManualSync}
                                className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                            >
                                {listRefreshing
                                    ? t("layout.notebook.syncing", "Syncing...")
                                    : t("layout.notebook.syncCloud", "同步云端")}
                            </button>
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
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
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
                                    {t("layout.notebook.summaryStartDate", "Start time")}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => openPicker("start")}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-base font-semibold leading-tight text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                >
                                    {formatSummaryDateTime(summaryStartDate)}
                                </button>
                            </label>
                            <label className="block">
                                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                                    {t("layout.notebook.summaryEndDate", "End time")}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => openPicker("end")}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-base font-semibold leading-tight text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                >
                                    {formatSummaryDateTime(summaryEndDate)}
                                </button>
                            </label>
                        </div>
                        <label className="block">
                            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                                {t("layout.notebook.summaryDirectionLabel", "Summary direction")}
                            </div>
                            <select
                                value={summaryDirection}
                                onChange={(event) => setSummaryDirection(event.target.value)}
                                className="h-10 w-[320px] max-w-full rounded-lg border border-gray-200 bg-white px-3 text-left text-base font-semibold leading-tight text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            >
                                {summaryDirectionOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {summaryDirection === "custom" ? (
                            <label className="block">
                                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                                    {t("layout.notebook.summaryCustomRequirementLabel", "Custom requirement")}
                                </div>
                                <textarea
                                    value={summaryCustomRequirement}
                                    onChange={(event) => setSummaryCustomRequirement(event.target.value)}
                                    placeholder={t(
                                        "layout.notebook.summaryCustomRequirementPlaceholder",
                                        "Describe your custom summary requirement",
                                    )}
                                    rows={3}
                                    className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                            </label>
                        ) : null}
                        {hasInvalidDateRange && (
                            <div className="text-xs text-rose-500">
                                {t("layout.notebook.summaryDateRangeInvalid", "Start date must be earlier than or equal to end date.")}
                            </div>
                        )}
                        {!hasInvalidDateRange && hasSummaryRangeExceeded && (
                            <div className="text-xs text-rose-500">
                                {t("layout.notebook.summaryRangeExceeded", "Time range cannot exceed 3 days.")}
                            </div>
                        )}
                        {!hasInvalidDateRange && !hasSummaryRangeExceeded && summaryConfirmHint ? (
                            <div className="text-xs text-slate-500 dark:text-slate-400">{summaryConfirmHint}</div>
                        ) : null}
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                disabled={summaryConfirmLoading || !summarySelectedTarget || !summaryStartDate || !summaryEndDate || hasInvalidDateRange || hasSummaryRangeExceeded}
                                onClick={() => onSummaryConfirm({
                                    summaryDirection,
                                    summaryCustomRequirement: summaryDirection === "custom"
                                        ? (summaryCustomRequirement.trim() || null)
                                        : null,
                                })}
                                className="inline-flex items-center justify-center rounded-xl bg-[#2F5C56] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500"
                            >
                                {summaryConfirmLoading ? t("common.loading", "Loading...") : t("layout.notebook.summaryConfirm", "Confirm")}
                            </button>
                            <button
                                type="button"
                                aria-label={t("layout.notebook.summaryRangeHelp", "Summary range limit: up to 3 days.")}
                                title={t("layout.notebook.summaryRangeHelp", "Summary range limit: up to 3 days.")}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                            >
                                ?
                            </button>
                        </div>
                        {summaryMobilePanel ? (
                            <div className="pt-2 lg:hidden">
                                {summaryMobilePanel}
                            </div>
                        ) : null}
                        {pickerTarget ? (
                            <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-3 sm:items-center sm:justify-center">
                                <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-4 text-slate-100 shadow-2xl">
                                    <div className="mb-3 text-sm font-semibold">
                                        {pickerTarget === "start"
                                            ? t("layout.notebook.summaryStartDate", "Start time")
                                            : t("layout.notebook.summaryEndDate", "End time")}
                                    </div>
                                    <div className="grid grid-cols-4 gap-2">
                                        <div className="max-h-48 overflow-y-auto gt-visible-scrollbar rounded-lg border border-slate-700 bg-slate-950 p-1">
                                            {pickerYears.map((year) => (
                                                <button
                                                    key={`year-${year}`}
                                                    type="button"
                                                    onClick={() => {
                                                        const nextYear = year;
                                                        const maxDay = daysInMonth(nextYear, pickerMonth);
                                                        setPickerYear(nextYear);
                                                        setPickerDay((prev) => Math.min(prev, maxDay));
                                                    }}
                                                    className={`block w-full rounded-md px-2 py-1 text-sm ${year === pickerYear ? "bg-emerald-500 text-white" : "text-slate-300 hover:bg-slate-800"}`}
                                                >
                                                    {year}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="max-h-48 overflow-y-auto gt-visible-scrollbar rounded-lg border border-slate-700 bg-slate-950 p-1">
                                            {pickerMonths.map((month) => (
                                                <button
                                                    key={`month-${month}`}
                                                    type="button"
                                                    onClick={() => {
                                                        const nextMonth = month;
                                                        const maxDay = daysInMonth(pickerYear, nextMonth);
                                                        setPickerMonth(nextMonth);
                                                        setPickerDay((prev) => Math.min(prev, maxDay));
                                                    }}
                                                    className={`block w-full rounded-md px-2 py-1 text-sm ${month === pickerMonth ? "bg-emerald-500 text-white" : "text-slate-300 hover:bg-slate-800"}`}
                                                >
                                                    {String(month).padStart(2, "0")}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="max-h-48 overflow-y-auto gt-visible-scrollbar rounded-lg border border-slate-700 bg-slate-950 p-1">
                                            {pickerDays.map((day) => (
                                                <button
                                                    key={`day-${day}`}
                                                    type="button"
                                                    onClick={() => setPickerDay(day)}
                                                    className={`block w-full rounded-md px-2 py-1 text-sm ${day === pickerDay ? "bg-emerald-500 text-white" : "text-slate-300 hover:bg-slate-800"}`}
                                                >
                                                    {String(day).padStart(2, "0")}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="max-h-48 overflow-y-auto gt-visible-scrollbar rounded-lg border border-slate-700 bg-slate-950 p-1">
                                            {pickerHours.map((hour) => (
                                                <button
                                                    key={`hour-${hour}`}
                                                    type="button"
                                                    onClick={() => setPickerHour(hour)}
                                                    className={`block w-full rounded-md px-2 py-1 text-sm ${hour === pickerHour ? "bg-emerald-500 text-white" : "text-slate-300 hover:bg-slate-800"}`}
                                                >
                                                    {`${String(hour).padStart(2, "0")}:00`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="mt-4 flex justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setPickerTarget(null)}
                                            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                                        >
                                            {t("common.cancel", "Cancel")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={confirmPicker}
                                            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400"
                                        >
                                            {t("common.confirm", "Confirm")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
                {mode === "notebook" && listRefreshing && items.length > 0 && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">
                        {t("layout.notebook.syncing")}
                    </div>
                )}
                {mode === "notebook" && listState === "loading" && items.length === 0 && (
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
                                        {item.sourceScope === "company"
                                            ? t("layout.notebook.itemScopeCompany", "Company")
                                            : t("layout.notebook.itemScopePersonal", "Personal")}
                                    </span>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${typeChip(item.isIndexable)}`}>
                                        {item.isIndexable
                                            ? t("layout.notebook.itemTypeKnowledge", "Knowledge")
                                            : t("layout.notebook.itemTypeNote", "Note")}
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
