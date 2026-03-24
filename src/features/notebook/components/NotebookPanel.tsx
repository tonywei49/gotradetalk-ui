import type { NotebookChunk, NotebookItem, NotebookParsedPreview } from "../types";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useRef, useState } from "react";
import type { NotebookRequestDebugSnapshot } from "../../../services/notebookApi";
import { NotebookParsedSection } from "./NotebookParsedSection";
import { ChunkSettingsPanel, type ChunkSettings } from "./ChunkSettingsPanel";
import type { NotebookAuthPhase, NotebookErrorPolicy } from "../utils/deriveNotebookAuthUiState";

type NotebookPanelProps = {
    enabled: boolean;
    notebookAuthPhase: NotebookAuthPhase;
    notebookErrorPolicy: NotebookErrorPolicy;
    onReloginForNotebook: () => void;
    selectedItem: NotebookItem | null;
    isCreatingDraft: boolean;
    editorTitle: string;
    editorContent: string;
    isEditing: boolean;
    setEditorTitle: (value: string) => void;
    setEditorContent: (value: string) => void;
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onSaveAsKnowledge: () => void;
    onSaveAsNote: () => void;
    onDelete: () => void;
    onSwitchToKnowledge: () => void;
    onSwitchToNote: () => void;
    onRetryIndex: () => void;
    onAttachFile: () => void;
    onUploadFile: (file: File) => void;
    uploadLimitMb: number;
    onDeleteFile: (fileId: string) => void;
    onDownloadFile: (mxcUrl: string, preferredName?: string | null) => void;
    onPreviewFile: (file: {
        matrixMediaMxc: string;
        matrixMediaName?: string | null;
        matrixMediaMime?: string | null;
    }) => void;
    draftFiles?: NotebookItem["files"];
    previewBusy: boolean;
    previewError: string | null;
    parsedPreview: NotebookParsedPreview | null;
    chunks: NotebookChunk[];
    chunksTotal: number;
    busy: boolean;
    actionError: string | null;
    requestDebug?: NotebookRequestDebugSnapshot | null;
    onMobileBack?: () => void;
    chunkSettings?: ChunkSettings;
    onChunkSettingsChange?: (settings: ChunkSettings) => void;
    uploadState?: {
        busy: boolean;
        progress: number;
        fileName: string | null;
        error: string | null;
    };
};

function indexHint(item: NotebookItem, t: TFunction): { tone: string; text: string } {
    if (!item.isIndexable) {
        return {
            tone: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
            text: t("layout.notebook.noteModeHint", "Currently in note mode. This item is not included in knowledge retrieval."),
        };
    }
    if (item.indexStatus === "pending") {
        return {
            tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/30 dark:text-amber-200",
            text: t("layout.notebook.indexPendingHint", "Index queued. Search will be available soon."),
        };
    }
    if (item.indexStatus === "running") {
        return {
            tone: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-900/30 dark:text-sky-200",
            text: t("layout.notebook.indexRunningHint", "Indexing in progress. Search will be available in a few seconds."),
        };
    }
    if (item.indexStatus === "failed") {
        return {
            tone: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200",
            text: item.indexError
                ? t("layout.notebook.indexFailedWithError", "Index failed: {{error}}", { error: item.indexError })
                : t("layout.notebook.indexFailedHint", "Index failed. Please try again later."),
        };
    }
    return {
        tone: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/30 dark:text-emerald-200",
        text: t("layout.notebook.indexSuccessHint", "Index complete. This item is ready for retrieval."),
    };
}

export function NotebookPanel({
    enabled,
    notebookAuthPhase,
    notebookErrorPolicy,
    onReloginForNotebook,
    selectedItem,
    isCreatingDraft,
    editorTitle,
    editorContent,
    isEditing,
    setEditorTitle,
    setEditorContent,
    onStartEdit,
    onCancelEdit,
    onSaveAsKnowledge,
    onSaveAsNote,
    onDelete,
    onSwitchToKnowledge,
    onSwitchToNote,
    onRetryIndex,
    onAttachFile,
    onUploadFile,
    uploadLimitMb,
    onDeleteFile,
    onDownloadFile,
    onPreviewFile,
    draftFiles,
    previewBusy,
    previewError,
    parsedPreview,
    chunks,
    chunksTotal,
    busy,
    actionError,
    requestDebug,
    onMobileBack,
    chunkSettings,
    onChunkSettingsChange,
    uploadState,
}: NotebookPanelProps) {
    const { t } = useTranslation();
    const notebookUploadInputRef = useRef<HTMLInputElement | null>(null);
    const [showChunkConfirm, setShowChunkConfirm] = useState(false);
    void requestDebug;
    const isNotebookBootstrapping = notebookAuthPhase === "bootstrapping";
    const isNotebookReloginRequired = notebookErrorPolicy === "relogin-required";
    const isNotebookRetryableServiceError = notebookErrorPolicy === "retryable-service-error";

    if (isNotebookBootstrapping) {
        return (
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="w-full max-w-xl rounded-2xl border border-sky-200 bg-sky-50 px-5 py-6 text-sky-800 dark:border-sky-900/50 dark:bg-sky-900/20 dark:text-sky-100">
                    <div className="text-lg font-semibold">
                        {t("layout.notebook.authBootstrapping", "正在同步 Notebook 授權…")}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-sky-700 dark:text-sky-100/80">
                        {t("layout.notebook.authBootstrappingHint", "We are restoring Notebook access and loading the workspace cache.")}
                    </div>
                </div>
            </div>
        );
    }

    if (isNotebookReloginRequired) {
        return (
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="w-full max-w-xl rounded-2xl border border-rose-200 bg-rose-50 px-5 py-6 text-rose-800 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-100">
                    <div className="text-lg font-semibold">
                        {t("layout.notebook.authFailed", "Notebook 驗證失敗，請重新登入")}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-rose-700 dark:text-rose-100/80">
                        {t("layout.notebook.authFailedReloginHint", "Notebook auth is no longer valid. Please re-login to continue.")}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={onReloginForNotebook}
                            className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white"
                        >
                            {t("layout.relogin", "重新登入")}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!enabled) {
        return (
            <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
                {t("layout.notebook.capabilityUnavailable", "Notebook capability unavailable.")}
            </div>
        );
    }

    if (!selectedItem && !isCreatingDraft) {
        return (
            <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
                {t("layout.notebook.selectItemEmpty", "Select or create a notebook item.")}
            </div>
        );
    }

    const hint = isCreatingDraft
        ? {
            tone: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
            text: t("layout.notebook.draftHint", "Draft not saved yet. Finish the content and choose to save it as knowledge or note."),
        }
        : indexHint(selectedItem as NotebookItem, t);
    const isCompanyReadOnly = Boolean(!isCreatingDraft && (selectedItem?.sourceScope === "company" || selectedItem?.readOnly));
    const visibleFiles = (isCreatingDraft || isEditing) ? (draftFiles || []) : (selectedItem?.files || []);

    return (
        <div className="relative flex h-full flex-col bg-white dark:bg-slate-900">
            <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    {onMobileBack && (
                        <button
                            type="button"
                            onClick={onMobileBack}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                            aria-label={t("layout.backToList")}
                        >
                            &lt;
                        </button>
                    )}
                    <div className="text-[17px] font-semibold text-slate-800 dark:text-slate-100">
                        {t("layout.notebook.detailTitle", "Notebook Detail")}
                    </div>
                </div>
                <div className={`mt-3 rounded-xl border px-4 py-3 text-[15px] ${hint.tone}`}>{hint.text}</div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar p-6 space-y-4">
                <label className="block">
                    <div className="mb-1.5 text-[13px] font-semibold uppercase text-slate-500">
                        {t("layout.notebook.fieldTitle", "Title")}
                    </div>
                    <input
                        type="text"
                        value={editorTitle}
                        readOnly={!isEditing || isCompanyReadOnly}
                        onChange={(event) => setEditorTitle(event.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                    />
                </label>
                <label className="block">
                    <div className="mb-1.5 text-[13px] font-semibold uppercase text-slate-500">
                        {t("layout.notebook.fieldContent", "Content")}
                    </div>
                    <textarea
                        value={editorContent}
                        readOnly={!isEditing || isCompanyReadOnly}
                        onChange={(event) => setEditorContent(event.target.value)}
                        rows={12}
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
                    />
                </label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <div className="mb-2 font-semibold">
                        {t("layout.notebook.attachedFiles", "Attached files")} ({visibleFiles.length || 0})
                    </div>
                    <div className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {t("layout.notebook.singleFileLimit", "Single file limit: {{size}}MB", { size: uploadLimitMb })}
                    </div>
                    {uploadState?.busy && (
                        <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-700 dark:border-sky-900/50 dark:bg-sky-900/20 dark:text-sky-200">
                            <div className="flex items-center justify-between gap-3">
                                <span className="truncate">{uploadState.fileName || t("layout.notebook.uploadingFile", "Uploading file...")}</span>
                                <span>{Math.max(0, Math.min(100, uploadState.progress))}%</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded bg-sky-100 dark:bg-slate-700">
                                <div className="h-full rounded bg-sky-500 transition-all" style={{ width: `${Math.max(4, uploadState.progress)}%` }} />
                            </div>
                        </div>
                    )}
                    {uploadState?.error && (
                        <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-200">
                            {uploadState.error}
                        </div>
                    )}
                    {(isCreatingDraft || isEditing) ? (
                        visibleFiles.length === 0 ? (
                            <div className="text-slate-500 dark:text-slate-400">
                                {t("layout.notebook.draftFilesHint", "You can upload or link files first. They will be saved together with the draft.")}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {visibleFiles.map((file) => (
                                    <div key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                                        <div className="min-w-0 flex-1 truncate">
                                            {file.matrixMediaName || file.matrixMediaMxc}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => onPreviewFile(file)}
                                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                                            >
                                                {t("layout.notebook.previewFile", "Preview")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onDownloadFile(file.matrixMediaMxc, file.matrixMediaName)}
                                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                                            >
                                                {t("layout.notebook.downloadFile", "Download")}
                                            </button>
                                            {!isCompanyReadOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() => onDeleteFile(file.id)}
                                                    disabled={busy}
                                                    className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-600 disabled:opacity-60 dark:border-rose-700 dark:text-rose-300"
                                                >
                                                    {t("layout.notebook.removeFile", "Remove")}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    ) : visibleFiles.length === 0 ? (
                        <div className="text-slate-500 dark:text-slate-400">{t("layout.notebook.noFiles", "No files yet.")}</div>
                    ) : (
                        <div className="space-y-2">
                            {visibleFiles.map((file) => (
                                <div key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                                    <div className="min-w-0 flex-1 truncate">
                                        {file.matrixMediaName || file.matrixMediaMxc}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => onPreviewFile(file)}
                                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                                        >
                                            {t("layout.notebook.previewFile", "Preview")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onDownloadFile(file.matrixMediaMxc, file.matrixMediaName)}
                                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                                        >
                                            {t("layout.notebook.downloadFile", "Download")}
                                        </button>
                                        {isEditing && !isCompanyReadOnly && (
                                            <button
                                                type="button"
                                                onClick={() => onDeleteFile(file.id)}
                                                disabled={busy}
                                                className="rounded border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-600 disabled:opacity-60 dark:border-rose-700 dark:text-rose-300"
                                            >
                                                {t("layout.notebook.removeFile", "Remove")}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {!isCreatingDraft && selectedItem && (
                    <NotebookParsedSection
                        key={selectedItem.id}
                        previewBusy={previewBusy}
                        previewError={previewError}
                        parsedPreview={parsedPreview}
                        chunks={chunks}
                        chunksTotal={chunksTotal}
                    />
                )}
                {actionError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                        {actionError}
                    </div>
                )}
                {!isCreatingDraft && selectedItem?.indexStatus === "failed" && isNotebookRetryableServiceError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                        <div>
                            {selectedItem.indexError
                                ? t("layout.notebook.indexFailedWithError", "Index failed: {{error}}", { error: selectedItem.indexError })
                                : t("layout.notebook.indexFailedShort", "Index failed")}
                        </div>
                        <button
                            type="button"
                            onClick={onRetryIndex}
                            disabled={busy}
                            className="mt-2 rounded border border-rose-300 px-2 py-1 text-xs font-semibold disabled:opacity-60 dark:border-rose-700"
                        >
                            {t("layout.notebook.retryIndex", "Retry index")}
                        </button>
                    </div>
                )}
            </div>
            <div className="border-t border-gray-100 px-6 py-4 dark:border-slate-800">
                <input
                    ref={notebookUploadInputRef}
                    type="file"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        onUploadFile(file);
                    }}
                />
                <div className="flex flex-wrap gap-2">
                    {isEditing && !isCompanyReadOnly ? (
                        <>
                            <button
                                type="button"
                                onClick={() => setShowChunkConfirm(true)}
                                disabled={busy}
                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {t("layout.notebook.saveAsKnowledge", "Save as knowledge")}
                            </button>
                            <button
                                type="button"
                                onClick={onSaveAsNote}
                                disabled={busy}
                                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                            >
                                {t("layout.notebook.saveAsNote", "Save as note")}
                            </button>
                            <button
                                type="button"
                                onClick={() => notebookUploadInputRef.current?.click()}
                                disabled={busy}
                                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                            >
                                {t("layout.notebook.uploadFile", "Upload file")}
                            </button>
                            <button
                                type="button"
                                onClick={onAttachFile}
                                disabled={busy}
                                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                            >
                                {t("layout.notebook.linkFile", "Link file")}
                            </button>
                            {!isCreatingDraft && (
                                <>
                                    <button
                                        type="button"
                                        onClick={onDelete}
                                        disabled={busy}
                                        className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-700 dark:text-rose-300"
                                    >
                                        {t("common.delete", "Delete")}
                                    </button>
                                </>
                            )}
                            <button
                                type="button"
                                onClick={onCancelEdit}
                                disabled={busy}
                                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
                            >
                                {t("layout.notebook.cancelEdit", "Cancel edit")}
                            </button>
                        </>
                    ) : (
                        <>
                            {!isCompanyReadOnly && (
                                <button
                                    type="button"
                                    onClick={onStartEdit}
                                    disabled={busy}
                                    className="rounded-lg bg-[#2F5C56] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {t("common.edit", "Edit")}
                                </button>
                            )}
                            {!isCompanyReadOnly && !selectedItem?.isIndexable ? (
                                <button
                                    type="button"
                                    onClick={onSwitchToKnowledge}
                                    disabled={busy}
                                    className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700 dark:text-emerald-300"
                                >
                                    {t("layout.notebook.switchToKnowledge", "Convert to knowledge")}
                                </button>
                            ) : !isCompanyReadOnly ? (
                                <button
                                    type="button"
                                    onClick={onSwitchToNote}
                                    disabled={busy}
                                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                                >
                                    {t("layout.notebook.switchToNote", "Convert to note")}
                                </button>
                            ) : (
                                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-900/20 dark:text-indigo-200">
                                    {t("layout.notebook.companyReadOnlyHint", "Company knowledge items are read-only and cannot be edited or deleted.")}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
            {showChunkConfirm && chunkSettings && onChunkSettingsChange && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
                    <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-3 text-base font-semibold text-slate-800 dark:text-slate-100">
                            {t("layout.notebook.chunkSettingsTitle", "Configure chunks before saving as knowledge")}
                        </div>
                        <ChunkSettingsPanel settings={chunkSettings} onChange={onChunkSettingsChange} />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowChunkConfirm(false)}
                                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                            >
                                {t("common.cancel", "Cancel")}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowChunkConfirm(false);
                                    onSaveAsKnowledge();
                                }}
                                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                            >
                                {t("layout.notebook.confirmAndSave", "Confirm and save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
