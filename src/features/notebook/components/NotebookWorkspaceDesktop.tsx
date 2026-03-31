import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { getNotebookAdapter } from "..";
import type { NotebookAuthContext, NotebookItemFile } from "../types";
import { useNotebookModule } from "../useNotebookModule";
import { NotebookSidebar, type SummaryDirectionPayload, type SummarySearchPersonItem, type SummarySearchRoomItem, type SummarySearchTarget } from "./NotebookSidebar";
import { NotebookPanel } from "./NotebookPanel";
import { isNotebookTerminalAuthFailure, type NotebookTerminalAuthFailureSignal } from "../utils/isNotebookTerminalAuthFailure";

type NotebookWorkspaceDesktopProps = {
    auth: NotebookAuthContext | null;
    enabled: boolean;
    refreshToken: number;
    onAuthFailure: () => Promise<string | null>;
    onTerminalAuthFailure: (signal: NotebookTerminalAuthFailureSignal) => void;
    workspaceAvailable: boolean;
    userType: string | null;
    sidebarMode: "notebook" | "chatSummary";
    onSidebarModeChange: (value: "notebook" | "chatSummary") => void;
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
    summaryWorkspacePanel: ReactNode;
    matrixClient: MatrixClient | null;
    matrixAccessToken?: string | null;
    uploadLimitMb: number;
    pushToast: (tone: "error" | "warn" | "success", message: string, duration?: number) => void;
    onOpenPreview: (payload: { url: string; type: "image" | "video" | "audio" | "pdf"; name: string; revokeOnClose?: boolean }) => void;
};

function parseMxcUri(mxcUrl: string): { serverName: string; mediaId: string } | null {
    const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxcUrl);
    if (!match) return null;
    return { serverName: match[1], mediaId: match[2] };
}

function isMockNotebookMxc(mxcUrl: string): boolean {
    const parsed = parseMxcUri(mxcUrl);
    return parsed?.serverName === "mock.server";
}

function getFilePreviewType(item: { mimeType?: string | null }): "image" | "video" | "audio" | "pdf" | null {
    const mimeType = (item.mimeType || "").toLowerCase();
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.includes("pdf")) return "pdf";
    return null;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                resolve(reader.result);
                return;
            }
            reject(new Error("INVALID_FILE_READER_RESULT"));
        };
        reader.onerror = () => reject(reader.error ?? new Error("FILE_READER_FAILED"));
        reader.readAsDataURL(blob);
    });
}

async function fetchMediaBlob(url: string, accessToken?: string | null): Promise<Blob> {
    const response = await fetch(url, {
        headers: accessToken
            ? {
                Authorization: `Bearer ${accessToken}`,
            }
            : undefined,
    });
    if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
    }
    return response.blob();
}

export function NotebookWorkspaceDesktop({
    auth,
    enabled,
    refreshToken,
    onAuthFailure,
    onTerminalAuthFailure,
    workspaceAvailable,
    userType,
    sidebarMode,
    onSidebarModeChange,
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
    summaryWorkspacePanel,
    matrixClient,
    matrixAccessToken = null,
    uploadLimitMb,
    pushToast,
    onOpenPreview,
}: NotebookWorkspaceDesktopProps) {
    const adapter = useMemo(() => getNotebookAdapter(), []);
    const notebookModule = useNotebookModule({
        adapter,
        auth,
        enabled,
        refreshToken,
        onAuthFailure,
    });
    const [notebookFileActionError, setNotebookFileActionError] = useState<string | null>(null);
    const [notebookUploadState, setNotebookUploadState] = useState<{
        busy: boolean;
        progress: number;
        fileName: string | null;
        error: string | null;
    }>({
        busy: false,
        progress: 0,
        fileName: null,
        error: null,
    });

    useEffect(() => {
        const debugError = notebookModule.requestDebug?.error;
        if (!debugError) return;
        if (!notebookModule.listError && !notebookModule.actionError) return;
        const signal = {
            code: debugError.code,
            status: debugError.status,
            terminal: debugError.status === 401,
        } satisfies NotebookTerminalAuthFailureSignal;
        if (!isNotebookTerminalAuthFailure(signal)) return;
        onTerminalAuthFailure(signal);
    }, [notebookModule.actionError, notebookModule.listError, notebookModule.requestDebug, onTerminalAuthFailure]);

    useEffect(() => {
        if (!enabled) return;
        if (userType === "client" && notebookModule.sourceScope === "company") {
            notebookModule.setSourceScope("personal");
            notebookModule.setViewFilter("all");
        }
    }, [enabled, notebookModule, userType]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900 lg:flex-row">
            <aside className="min-h-0 w-full border-b border-gray-100 dark:border-slate-800 lg:w-80 lg:flex-none lg:border-b-0 lg:border-r">
                {enabled ? (
                    <NotebookSidebar
                        listState={notebookModule.listState}
                        listError={notebookModule.listError}
                        search={notebookModule.search}
                        onSearchChange={notebookModule.setSearch}
                        items={notebookModule.items}
                        selectedItemId={notebookModule.selectedItemId}
                        filter={notebookModule.viewFilter}
                        onFilterChange={notebookModule.setViewFilter}
                        sourceScope={notebookModule.sourceScope}
                        onSourceScopeChange={notebookModule.setSourceScope}
                        onSelect={(itemId) => {
                            notebookModule.setSelectedItemId(itemId);
                        }}
                        onCreate={() => {
                            void notebookModule.createItem();
                        }}
                        onManualSync={() => {
                            void notebookModule.syncItems({ force: true, showIndicator: true });
                        }}
                        manualSyncAvailable={notebookModule.hasRemoteNotebookApi}
                        busy={notebookModule.actionBusy}
                        listRefreshing={notebookModule.listRefreshing}
                        hasMore={notebookModule.hasMore}
                        loadingMore={notebookModule.loadingMore}
                        onLoadMore={() => {
                            void notebookModule.loadMore();
                        }}
                        showCompanyFilter={userType !== "client"}
                        mode={sidebarMode}
                        onModeChange={onSidebarModeChange}
                        summaryQuery={summaryQuery}
                        onSummaryQueryChange={onSummaryQueryChange}
                        onSummarySearchNow={onSummarySearchNow}
                        summaryLoading={summaryLoading}
                        summaryError={summaryError}
                        summaryPeopleResults={summaryPeopleResults}
                        summaryRoomResults={summaryRoomResults}
                        summarySelectedTarget={summarySelectedTarget}
                        onSummarySelectTarget={onSummarySelectTarget}
                        summaryStartDate={summaryStartDate}
                        summaryEndDate={summaryEndDate}
                        onSummaryStartDateChange={onSummaryStartDateChange}
                        onSummaryEndDateChange={onSummaryEndDateChange}
                        onSummaryConfirm={onSummaryConfirm}
                        summaryConfirmLoading={summaryConfirmLoading}
                        summaryConfirmHint={summaryConfirmHint}
                        summaryMobilePanel={sidebarMode === "chatSummary" ? summaryWorkspacePanel : null}
                    />
                ) : (
                    <div className="flex h-full min-h-0 items-center justify-center bg-white p-6 dark:bg-slate-900">
                        <div className="max-w-sm rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-center dark:border-slate-800 dark:bg-slate-950">
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Preparing notebook</div>
                            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">Local notebook cache is loading first, then recent changes will sync in the background.</div>
                        </div>
                    </div>
                )}
            </aside>
            <main className="flex-1 min-h-0 overflow-hidden bg-white dark:bg-slate-900">
                {!enabled ? (
                    <div className="flex h-full min-h-0 items-center justify-center bg-white p-6 dark:bg-slate-900">
                        <div className="max-w-sm rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-center dark:border-slate-800 dark:bg-slate-950">
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Preparing notebook</div>
                            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">Local notebook cache is loading first, then recent changes will sync in the background.</div>
                        </div>
                    </div>
                ) : sidebarMode === "chatSummary" ? (
                    <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar bg-white p-6 dark:bg-slate-900">
                        {summaryWorkspacePanel}
                    </div>
                ) : (
                    <NotebookPanel
                        enabled={workspaceAvailable}
                        selectedItem={notebookModule.selectedItem}
                        isCreatingDraft={notebookModule.isCreatingDraft}
                        editorTitle={notebookModule.editorTitle}
                        editorContent={notebookModule.editorContent}
                        isEditing={notebookModule.isEditing}
                        setEditorTitle={notebookModule.setEditorTitle}
                        setEditorContent={notebookModule.setEditorContent}
                        onStartEdit={() => {
                            notebookModule.startEdit();
                        }}
                        onCancelEdit={() => {
                            notebookModule.cancelEdit();
                        }}
                        onSaveAsKnowledge={() => {
                            void notebookModule.saveItemAs(true);
                        }}
                        onSaveAsNote={() => {
                            void notebookModule.saveItemAs(false);
                        }}
                        onDelete={() => {
                            void notebookModule.deleteItem();
                        }}
                        onSwitchToKnowledge={() => {
                            notebookModule.switchItemMode(true);
                        }}
                        onSwitchToNote={() => {
                            notebookModule.switchItemMode(false);
                        }}
                        onRetryIndex={() => {
                            void notebookModule.retryIndex();
                        }}
                        onAttachFile={() => {
                            const mxc = window.prompt("Input matrix_media_mxc (mxc://server/mediaId)");
                            if (!mxc) return;
                            const fileName = window.prompt("Input matrix_media_name (optional)") || "linked-file";
                            const mime = window.prompt("Input matrix_media_mime (optional)") || undefined;
                            void notebookModule.attachFile({
                                matrixMediaMxc: mxc,
                                matrixMediaName: fileName,
                                matrixMediaMime: mime,
                                isIndexable: false,
                            });
                        }}
                        onUploadFile={(file) => {
                            if (!matrixClient) return;
                            setNotebookFileActionError(null);
                            const maxBytes = uploadLimitMb * 1024 * 1024;
                            if (file.size > maxBytes) {
                                window.alert(`檔案超過上限（${uploadLimitMb}MB）`);
                                return;
                            }
                            void (async () => {
                                setNotebookUploadState({ busy: true, progress: 0, fileName: file.name, error: null });
                                try {
                                    const uploadResult = (await matrixClient.uploadContent(file, {
                                        includeFilename: false,
                                        progressHandler: (progressInfo) => {
                                            const loaded = Number(progressInfo.loaded ?? 0);
                                            const total = Number(progressInfo.total ?? file.size ?? 0);
                                            const nextProgress = total > 0 ? Math.round((loaded / total) * 100) : 0;
                                            setNotebookUploadState((prev) => ({
                                                ...prev,
                                                progress: Math.max(prev.progress, nextProgress),
                                            }));
                                        },
                                    })) as unknown;

                                    let mxcUrl = "";
                                    if (typeof uploadResult === "string") {
                                        if (uploadResult.startsWith("mxc://")) {
                                            mxcUrl = uploadResult;
                                        } else {
                                            try {
                                                const parsed = JSON.parse(uploadResult) as { content_uri?: string };
                                                mxcUrl = parsed.content_uri || "";
                                            } catch {
                                                mxcUrl = "";
                                            }
                                        }
                                    } else if (uploadResult && typeof uploadResult === "object") {
                                        const uri = (uploadResult as { content_uri?: string }).content_uri;
                                        mxcUrl = typeof uri === "string" ? uri : "";
                                    }

                                    if (!mxcUrl.startsWith("mxc://")) {
                                        throw new Error("Failed to upload file to Matrix media");
                                    }

                                    await notebookModule.attachFile({
                                        matrixMediaMxc: mxcUrl,
                                        matrixMediaName: file.name,
                                        matrixMediaMime: file.type || undefined,
                                        matrixMediaSize: file.size,
                                        isIndexable: false,
                                    });
                                    setNotebookUploadState({ busy: false, progress: 100, fileName: file.name, error: null });
                                    window.setTimeout(() => {
                                        setNotebookUploadState((prev) => prev.fileName === file.name ? { busy: false, progress: 0, fileName: null, error: null } : prev);
                                    }, 1200);
                                } catch {
                                    const message = "檔案上傳失敗，請稍後重試。";
                                    setNotebookUploadState({ busy: false, progress: 0, fileName: file.name, error: message });
                                    setNotebookFileActionError(message);
                                }
                            })();
                        }}
                        uploadLimitMb={uploadLimitMb}
                        onDeleteFile={(fileId) => {
                            void notebookModule.removeFile(fileId);
                        }}
                        onDownloadFile={(mxcUrl, preferredName) => {
                            if (!matrixClient) return;
                            setNotebookFileActionError(null);
                            if (isMockNotebookMxc(mxcUrl)) {
                                const message = "此檔案仍指向舊的 mock 快取資料，請重新整理 Notebook 後再試。";
                                setNotebookFileActionError(message);
                                pushToast("error", message);
                                void notebookModule.syncItems();
                                return;
                            }
                            const url = matrixClient.mxcUrlToHttp(mxcUrl);
                            if (!url) {
                                const message = "無法解析檔案下載地址。";
                                setNotebookFileActionError(message);
                                pushToast("error", message);
                                return;
                            }
                            void (async () => {
                                try {
                                    const blob = await fetchMediaBlob(url, matrixAccessToken);
                                    const blobUrl = URL.createObjectURL(blob);
                                    const anchor = document.createElement("a");
                                    anchor.href = blobUrl;
                                    anchor.download = preferredName || "notebook-file";
                                    anchor.rel = "noopener noreferrer";
                                    document.body.appendChild(anchor);
                                    anchor.click();
                                    document.body.removeChild(anchor);
                                    URL.revokeObjectURL(blobUrl);
                                } catch {
                                    const message = "檔案下載失敗，請確認 Matrix 媒體仍存在後再試。";
                                    setNotebookFileActionError(message);
                                    pushToast("error", message);
                                }
                            })();
                        }}
                        onPreviewFile={(file: Pick<NotebookItemFile, "matrixMediaMxc" | "matrixMediaName" | "matrixMediaMime">) => {
                            if (!matrixClient) return;
                            setNotebookFileActionError(null);
                            if (isMockNotebookMxc(file.matrixMediaMxc)) {
                                const message = "此檔案仍指向舊的 mock 快取資料，請重新整理 Notebook 後再試。";
                                setNotebookFileActionError(message);
                                pushToast("error", message);
                                void notebookModule.syncItems();
                                return;
                            }
                            const previewType = getFilePreviewType({ mimeType: file.matrixMediaMime });
                            if (!previewType) {
                                const message = "此檔案類型暫不支援預覽，請改用下載。";
                                setNotebookFileActionError(message);
                                pushToast("error", message);
                                return;
                            }
                            const url = matrixClient.mxcUrlToHttp(file.matrixMediaMxc);
                            if (!url) {
                                const message = "無法解析檔案預覽地址。";
                                setNotebookFileActionError(message);
                                pushToast("error", message);
                                return;
                            }
                            void (async () => {
                                try {
                                    const blob = await fetchMediaBlob(url, matrixAccessToken);
                                    const previewUrl = previewType === "pdf" ? await blobToDataUrl(blob) : URL.createObjectURL(blob);
                                    onOpenPreview({
                                        url: previewUrl,
                                        type: previewType,
                                        name: file.matrixMediaName || "notebook-file",
                                        revokeOnClose: previewType !== "pdf",
                                    });
                                } catch {
                                    const message = previewType === "pdf"
                                        ? "PDF 預覽失敗，請改用下載檢查原檔。"
                                        : "檔案預覽失敗，請稍後重試或改用下載。";
                                    setNotebookFileActionError(message);
                                    pushToast("error", message);
                                }
                            })();
                        }}
                        draftFiles={notebookModule.draftFiles}
                        previewBusy={notebookModule.previewBusy}
                        previewError={notebookModule.previewError}
                        parsedPreview={notebookModule.parsedPreview}
                        chunks={notebookModule.chunks}
                        chunksTotal={notebookModule.chunksTotal}
                        busy={notebookModule.actionBusy}
                        actionError={notebookModule.actionError || notebookFileActionError}
                        requestDebug={notebookModule.requestDebug}
                        chunkSettings={notebookModule.chunkSettings}
                        onChunkSettingsChange={notebookModule.setChunkSettings}
                        uploadState={notebookUploadState}
                    />
                )}
            </main>
        </div>
    );
}
