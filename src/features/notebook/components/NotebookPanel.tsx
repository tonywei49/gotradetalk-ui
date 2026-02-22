import type { NotebookChunk, NotebookItem, NotebookParsedPreview } from "../types";
import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { NotebookParsedSection } from "./NotebookParsedSection";

type NotebookPanelProps = {
    enabled: boolean;
    selectedItem: NotebookItem | null;
    editorTitle: string;
    editorContent: string;
    setEditorTitle: (value: string) => void;
    setEditorContent: (value: string) => void;
    onSave: () => void;
    onDelete: () => void;
    onAttachFile: () => void;
    onUploadFile: (file: File) => void;
    onDeleteFile: (fileId: string) => void;
    onDownloadFile: (mxcUrl: string, preferredName?: string | null) => void;
    previewBusy: boolean;
    previewError: string | null;
    parsedPreview: NotebookParsedPreview | null;
    chunks: NotebookChunk[];
    chunksTotal: number;
    busy: boolean;
    actionError: string | null;
    onMobileBack?: () => void;
};

function indexHint(item: NotebookItem): { tone: string; text: string } {
    if (item.indexStatus === "pending") {
        return {
            tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/30 dark:text-amber-200",
            text: "索引排隊中，稍後可檢索。",
        };
    }
    if (item.indexStatus === "running") {
        return {
            tone: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-900/30 dark:text-sky-200",
            text: "索引中，約數秒可檢索。",
        };
    }
    if (item.indexStatus === "failed") {
        return {
            tone: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200",
            text: item.indexError ? `索引失敗：${item.indexError}` : "索引失敗，請稍後重試。",
        };
    }
    return {
        tone: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/30 dark:text-emerald-200",
        text: "索引完成，可供檢索。",
    };
}

export function NotebookPanel({
    enabled,
    selectedItem,
    editorTitle,
    editorContent,
    setEditorTitle,
    setEditorContent,
    onSave,
    onDelete,
    onAttachFile,
    onUploadFile,
    onDeleteFile,
    onDownloadFile,
    previewBusy,
    previewError,
    parsedPreview,
    chunks,
    chunksTotal,
    busy,
    actionError,
    onMobileBack,
}: NotebookPanelProps) {
    const { t } = useTranslation();
    const notebookUploadInputRef = useRef<HTMLInputElement | null>(null);
    if (!enabled) {
        return (
            <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
                Notebook capability unavailable.
            </div>
        );
    }

    if (!selectedItem) {
        return (
            <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
                Select or create a notebook item.
            </div>
        );
    }

    const hint = indexHint(selectedItem);

    return (
        <div className="flex h-full flex-col bg-white dark:bg-slate-900">
            <div className="border-b border-gray-100 px-6 py-4 dark:border-slate-800">
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
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Notebook Detail</div>
                </div>
                <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${hint.tone}`}>{hint.text}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Title</div>
                    <input
                        type="text"
                        value={editorTitle}
                        onChange={(event) => setEditorTitle(event.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                </label>
                <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Content</div>
                    <textarea
                        value={editorContent}
                        onChange={(event) => setEditorContent(event.target.value)}
                        rows={12}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                </label>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <div className="mb-2 font-semibold">Attached files ({selectedItem.files.length})</div>
                    {selectedItem.files.length === 0 ? (
                        <div className="text-slate-500 dark:text-slate-400">No files yet.</div>
                    ) : (
                        <div className="space-y-2">
                            {selectedItem.files.map((file) => (
                                <div key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                                    <div className="min-w-0 flex-1 truncate">
                                        {file.matrixMediaName || file.matrixMediaMxc}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => onDownloadFile(file.matrixMediaMxc, file.matrixMediaName)}
                                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                                        >
                                            Download
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onDeleteFile(file.id)}
                                            disabled={busy}
                                            className="rounded border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-600 disabled:opacity-60 dark:border-rose-700 dark:text-rose-300"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <NotebookParsedSection
                    key={selectedItem.id}
                    previewBusy={previewBusy}
                    previewError={previewError}
                    parsedPreview={parsedPreview}
                    chunks={chunks}
                    chunksTotal={chunksTotal}
                />
                {actionError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                        {actionError}
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
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={busy}
                        className="rounded-lg bg-[#2F5C56] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Save
                    </button>
                    <button
                        type="button"
                        onClick={() => notebookUploadInputRef.current?.click()}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                    >
                        Upload file
                    </button>
                    <button
                        type="button"
                        onClick={onAttachFile}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                    >
                        Link file
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={busy}
                        className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-700 dark:text-rose-300"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}
