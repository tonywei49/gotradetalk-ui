import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchWithDesktopSupport } from "../desktop/fetchWithDesktopSupport";
import { traceEvent } from "../utils/debugTrace";
import { mapActionErrorToMessage } from "../utils/errorMessages";
import {
    filesByRoom,
    filterRoomFiles,
    filterRoomSummaries,
    paginateRoomFiles,
    summarizeFileRooms,
    type FileLibraryItem,
    type FileLibraryRoomSummary,
} from "../features/files/fileCenterRepository";
import {
    MATRIX_EVENT_TYPE_ROOM_MESSAGE,
    MATRIX_TIMELINE_BACKWARDS,
} from "../matrix/matrixEventConstants";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";

type ActiveTabValue = "chat" | "notebook" | "contacts" | "files" | "tasks" | "orders" | "settings" | "account";

interface FileCenterPanelProps {
    matrixClient: MatrixClient | null;
    matrixCredentials: { user_id: string; hs_url: string; access_token: string } | null;
    matrixAccessToken: string | null;
    selectedFileRoomId: string | null;
    setSelectedFileRoomId: React.Dispatch<React.SetStateAction<string | null>>;
    setActiveRoomId: (id: string) => void;
    setActiveTab: React.Dispatch<React.SetStateAction<ActiveTabValue>>;
    setJumpToEventId: React.Dispatch<React.SetStateAction<string | null>>;
    setMobileView: (view: "list" | "detail") => void;
    fileLibraryTick: number;
    setFileLibraryTick: React.Dispatch<React.SetStateAction<number>>;
    filesReady: boolean;
    isMobileApp: boolean;
}

const FILE_BATCH_DELETE_CONCURRENCY = 4;
const FILE_LIST_PAGE_SIZE = 80;
const FILE_HISTORY_TARGET_EVENTS = 260;
const FILE_HISTORY_SCROLLBACK_LIMIT = 50;
const FILE_HISTORY_MAX_ROUNDS = 6;

function parseMxcUri(mxcUrl: string): { serverName: string; mediaId: string } | null {
    const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxcUrl);
    if (!match) return null;
    return { serverName: match[1], mediaId: match[2] };
}

async function cleanupUploadedMedia(
    hsUrl: string,
    accessToken: string,
    mxcUrl: string,
): Promise<boolean> {
    const parsed = parseMxcUri(mxcUrl);
    if (!parsed) return false;
    const encodedServerName = encodeURIComponent(parsed.serverName);
    const encodedMediaId = encodeURIComponent(parsed.mediaId);
    const paths = [
        `/_matrix/client/v3/media/delete/${encodedServerName}/${encodedMediaId}`,
        `/_matrix/client/v1/media/delete/${encodedServerName}/${encodedMediaId}`,
        `/_matrix/media/v3/delete/${encodedServerName}/${encodedMediaId}`,
    ];
    for (const path of paths) {
        try {
            const endpoint = new URL(path, hsUrl);
            const response = await fetch(endpoint.toString(), {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            if (response.ok || response.status === 404) return true;
        } catch {
            // ignore and continue with next endpoint
        }
    }
    return false;
}

function mapMediaActionError(error: unknown): "STORAGE_QUOTA_EXCEEDED" | "NO_PERMISSION" | "GENERIC" {
    const maybeObj = error as { errcode?: string; statusCode?: number; message?: string } | null;
    const message = typeof maybeObj?.message === "string" ? maybeObj.message : String(error ?? "");
    const errcode = typeof maybeObj?.errcode === "string" ? maybeObj.errcode : "";
    const statusCode = typeof maybeObj?.statusCode === "number" ? maybeObj.statusCode : null;
    const normalized = `${errcode} ${message}`.toUpperCase();

    if (
        normalized.includes("M_LIMIT_EXCEEDED") ||
        normalized.includes("QUOTA") ||
        normalized.includes("STORAGE") ||
        statusCode === 413
    ) {
        return "STORAGE_QUOTA_EXCEEDED";
    }
    if (normalized.includes("M_FORBIDDEN") || statusCode === 401 || statusCode === 403) {
        return "NO_PERMISSION";
    }
    return "GENERIC";
}

function getFileTypeGroup(item: { msgtype: string; mimeType?: string }): "image" | "video" | "audio" | "pdf" | "other" {
    if (item.msgtype === "m.image") return "image";
    if (item.msgtype === "m.video") return "video";
    if (item.msgtype === "m.audio") return "audio";
    if ((item.mimeType || "").toLowerCase().includes("pdf")) return "pdf";
    return "other";
}

function getFilePreviewType(item: { msgtype: string; mimeType?: string }): "image" | "video" | "audio" | "pdf" | null {
    const type = getFileTypeGroup(item);
    if (type === "image" || type === "video" || type === "audio" || type === "pdf") return type;
    return null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
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
    const response = await fetchWithDesktopSupport(url, {
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

function formatBytesToMb(value: number): string {
    const mb = value / (1024 * 1024);
    return mb >= 100 ? mb.toFixed(0) : mb.toFixed(2);
}

function getFileExtension(fileName: string, mimeType?: string): string {
    const idx = fileName.lastIndexOf(".");
    if (idx >= 0 && idx < fileName.length - 1) {
        return fileName.slice(idx + 1).toUpperCase();
    }
    if (!mimeType) return "FILE";
    const simplified = mimeType.split("/")[1] || "file";
    return simplified.toUpperCase();
}

function getLoadedRoomEvents(room: Room, maxEvents = 4000): MatrixEvent[] {
    const out: MatrixEvent[] = [];
    const seen = new Set<string>();
    let timeline: ReturnType<Room["getLiveTimeline"]> | null = room.getLiveTimeline();
    while (timeline && out.length < maxEvents) {
        const events = timeline.getEvents();
        for (const event of events) {
            const key = event.getId() || `${event.getTs()}:${event.getSender()}:${event.getType()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(event);
            if (out.length >= maxEvents) break;
        }
        timeline = timeline.getNeighbouringTimeline(MATRIX_TIMELINE_BACKWARDS as never) ?? null;
    }
    return out;
}

function DeferredModulePanel({ title, description }: { title: string; description: string }) {
    return (
        <div className="flex h-full min-h-0 items-center justify-center bg-white p-6 dark:bg-slate-900">
            <div className="max-w-sm rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-center dark:border-slate-800 dark:bg-slate-950">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</div>
                <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</div>
            </div>
        </div>
    );
}

const getLocalPart = (value: string | null | undefined): string => {
    const str = String(value || "").trim();
    if (!str) return "";
    const withoutPrefix = str.startsWith("@") ? str.slice(1) : str;
    const colonIndex = withoutPrefix.indexOf(":");
    return colonIndex > 0 ? withoutPrefix.slice(0, colonIndex) : withoutPrefix;
};

const FileCenterPanel: React.FC<FileCenterPanelProps> = ({
    matrixClient,
    matrixCredentials,
    matrixAccessToken,
    selectedFileRoomId,
    setSelectedFileRoomId,
    setActiveRoomId,
    setActiveTab,
    setJumpToEventId,
    setMobileView,
    fileLibraryTick,
    setFileLibraryTick,
    filesReady,
    isMobileApp,
}) => {
    const { t } = useTranslation();

    const [fileListSearch, setFileListSearch] = useState("");
    const debouncedFileRoomSearch = "";
    const debouncedFileListSearch = fileListSearch;
    const [fileListTypeFilter, setFileListTypeFilter] = useState<"all" | "image" | "video" | "audio" | "pdf" | "other">("all");
    const [fileListPage, setFileListPage] = useState(1);
    const [fileBatchMode, setFileBatchMode] = useState(false);
    const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
    const [activeFileMenuEventId, setActiveFileMenuEventId] = useState<string | null>(null);
    const [showFileToolbarMenu, setShowFileToolbarMenu] = useState(false);
    const [fileActionError, setFileActionError] = useState<string | null>(null);
    const [fileDeletingEventId, setFileDeletingEventId] = useState<string | null>(null);
    const [fileBatchDeleting, setFileBatchDeleting] = useState(false);
    const [fileBatchDeleteProgress, setFileBatchDeleteProgress] = useState({ done: 0, total: 0 });
    const [fileHistoryLoadingRoomId, setFileHistoryLoadingRoomId] = useState<string | null>(null);
    const [filePreview, setFilePreview] = useState<{
        url: string;
        type: "image" | "video" | "audio" | "pdf";
        name: string;
        revokeOnClose?: boolean;
    } | null>(null);
    const [fileThumbnailUrls, setFileThumbnailUrls] = useState<Record<string, string>>({});
    const [previewZoom, setPreviewZoom] = useState(1);
    const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
    const fileThumbnailUrlsRef = useRef<Record<string, string>>({});
    const previewDraggingRef = useRef(false);
    const previewDragStartRef = useRef({ x: 0, y: 0 });
    const previewDragOriginRef = useRef({ x: 0, y: 0 });

    // Effects
    useEffect(() => {
        return () => {
            if (filePreview?.revokeOnClose) {
                URL.revokeObjectURL(filePreview.url);
            }
        };
    }, [filePreview]);

    useEffect(() => {
        fileThumbnailUrlsRef.current = fileThumbnailUrls;
    }, [fileThumbnailUrls]);

    useEffect(() => {
        return () => {
            Object.values(fileThumbnailUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
        };
    }, []);

    const closeFilePreview = useCallback(() => {
        setFilePreview((current) => {
            if (current?.revokeOnClose) {
                URL.revokeObjectURL(current.url);
            }
            return null;
        });
    }, []);

    // useMemo computations
    const myFileLibrary = useMemo<FileLibraryItem[]>(() => {
        if (!filesReady || !matrixClient || !matrixCredentials?.user_id) return [];
        void fileLibraryTick;
        const me = matrixCredentials.user_id;
        const rows: FileLibraryItem[] = [];
        matrixClient.getRooms().forEach((room) => {
            if (room.getMyMembership() !== "join" || room.isSpaceRoom()) return;
            const events = getLoadedRoomEvents(room);
            events.forEach((event) => {
                if (event.getType() !== MATRIX_EVENT_TYPE_ROOM_MESSAGE) return;
                if (event.isRedacted()) return;
                if (event.getSender() !== me) return;
                const eventId = event.getId();
                if (!eventId) return;
                const content = event.getContent() as {
                    msgtype?: string;
                    body?: string;
                    url?: string;
                    info?: { mimetype?: string; size?: number };
                } | null;
                if (!content?.url) return;
                const msgtype = content.msgtype || "";
                if (
                    msgtype !== "m.file" &&
                    msgtype !== "m.image" &&
                    msgtype !== "m.video" &&
                    msgtype !== "m.audio"
                ) {
                    return;
                }
                rows.push({
                    eventId,
                    roomId: room.roomId,
                    roomName: room.name || room.roomId,
                    body: content.body || eventId,
                    ts: event.getTs(),
                    msgtype,
                    mxcUrl: content.url,
                    mimeType: content.info?.mimetype,
                    sizeBytes: typeof content.info?.size === "number" ? content.info.size : null,
                });
            });
        });
        rows.sort((a, b) => b.ts - a.ts);
        return rows;
    }, [fileLibraryTick, filesReady, matrixClient, matrixCredentials?.user_id]);

    const roomSummaryList = useMemo<FileLibraryRoomSummary[]>(
        () => summarizeFileRooms(myFileLibrary),
        [myFileLibrary],
    );

    const filteredRoomSummaryList = useMemo(
        () => filterRoomSummaries(roomSummaryList, debouncedFileRoomSearch),
        [roomSummaryList, debouncedFileRoomSearch],
    );

    const selectedRoomFiles = useMemo(
        () => filesByRoom(myFileLibrary, selectedFileRoomId),
        [myFileLibrary, selectedFileRoomId],
    );

    const selectedRoomSummary = useMemo(
        () => roomSummaryList.find((item) => item.roomId === selectedFileRoomId) ?? null,
        [roomSummaryList, selectedFileRoomId],
    );

    const visibleSelectedRoomFiles = useMemo(
        () =>
            filterRoomFiles({
                roomFiles: selectedRoomFiles,
                keyword: debouncedFileListSearch,
                typeFilter: fileListTypeFilter,
                getFileTypeGroup,
            }),
        [selectedRoomFiles, debouncedFileListSearch, fileListTypeFilter],
    );

    const pagedVisibleSelectedRoomFiles = useMemo(
        () => paginateRoomFiles(visibleSelectedRoomFiles, fileListPage, FILE_LIST_PAGE_SIZE),
        [visibleSelectedRoomFiles, fileListPage],
    );

    const canLoadMoreFiles = pagedVisibleSelectedRoomFiles.length < visibleSelectedRoomFiles.length;

    // More effects
    useEffect(() => {
        // Since we are now in FileCenterPanel, we don't check for activeTab === "files" anymore 
        // as this component is only rendered when that tab is active.
        if (selectedFileRoomId && filteredRoomSummaryList.some((item) => item.roomId === selectedFileRoomId)) return;
        setSelectedFileRoomId(filteredRoomSummaryList[0]?.roomId ?? null);
    }, [filteredRoomSummaryList, selectedFileRoomId]);

    useEffect(() => {
        traceEvent("files.room_filter_changed", {
            roomSearch: debouncedFileRoomSearch,
            selectedRoomId: selectedFileRoomId,
            roomCount: filteredRoomSummaryList.length,
        });
    }, [debouncedFileRoomSearch, selectedFileRoomId, filteredRoomSummaryList.length]);

    useEffect(() => {
        if (!selectedFileRoomId) return;
        traceEvent("files.list_filter_changed", {
            roomId: selectedFileRoomId,
            keyword: debouncedFileListSearch,
            typeFilter: fileListTypeFilter,
            visibleCount: visibleSelectedRoomFiles.length,
        });
    }, [selectedFileRoomId, debouncedFileListSearch, fileListTypeFilter, visibleSelectedRoomFiles.length]);

    useEffect(() => {
        setFileListPage(1);
    }, [selectedFileRoomId, debouncedFileListSearch, fileListTypeFilter]);

    useEffect(() => {
        if (!matrixClient || !selectedFileRoomId) return;
        const room = matrixClient.getRoom(selectedFileRoomId);
        if (!room) return;
        let cancelled = false;
        void (async () => {
            setFileHistoryLoadingRoomId(selectedFileRoomId);
            let lastCount = room.getLiveTimeline().getEvents().length;
            for (let round = 0; round < FILE_HISTORY_MAX_ROUNDS; round += 1) {
                if (cancelled) return;
                if (lastCount >= FILE_HISTORY_TARGET_EVENTS) break;
                await matrixClient.scrollback(room, FILE_HISTORY_SCROLLBACK_LIMIT);
                const currentCount = room.getLiveTimeline().getEvents().length;
                if (currentCount <= lastCount) break;
                lastCount = currentCount;
            }
            if (!cancelled) {
                setFileLibraryTick((prev) => prev + 1);
                setFileHistoryLoadingRoomId((prev) => (prev === selectedFileRoomId ? null : prev));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [matrixClient, selectedFileRoomId, setFileLibraryTick]);

    useEffect(() => {
        setSelectedFileIds((prev) => prev.filter((eventId) => selectedRoomFiles.some((item) => item.eventId === eventId)));
    }, [selectedRoomFiles]);

    const getHttpFileUrl = useCallback((item: FileLibraryItem): string | null => {
        if (!matrixClient) return null;
        return matrixClient.mxcUrlToHttp(item.mxcUrl);
    }, [matrixClient]);

    useEffect(() => {
        const previewableItems = pagedVisibleSelectedRoomFiles.filter((item) => {
            const previewType = getFilePreviewType(item);
            return previewType === "image" || previewType === "video";
        });
        const previewableIds = new Set(previewableItems.map((item) => item.eventId));

        setFileThumbnailUrls((prev) => {
            const next: Record<string, string> = {};
            Object.entries(prev).forEach(([eventId, url]) => {
                if (previewableIds.has(eventId)) {
                    next[eventId] = url;
                } else {
                    URL.revokeObjectURL(url);
                }
            });
            return next;
        });

        let cancelled = false;
        previewableItems.forEach((item) => {
            const httpUrl = getHttpFileUrl(item);
            if (!httpUrl) return;
            if (fileThumbnailUrls[item.eventId]) return;
            void (async () => {
                try {
                    const blob = await fetchMediaBlob(httpUrl, matrixAccessToken);
                    const objectUrl = URL.createObjectURL(blob);
                    if (cancelled) {
                        URL.revokeObjectURL(objectUrl);
                        return;
                    }
                    setFileThumbnailUrls((prev) => {
                        const existing = prev[item.eventId];
                        if (existing) {
                            URL.revokeObjectURL(objectUrl);
                            return prev;
                        }
                        return { ...prev, [item.eventId]: objectUrl };
                    });
                } catch {
                    // Keep the card usable even if the preview thumbnail cannot be prefetched.
                }
            })();
        });

        return () => {
            cancelled = true;
        };
    }, [pagedVisibleSelectedRoomFiles, matrixAccessToken, getHttpFileUrl, fileThumbnailUrls]);

    // Callbacks
    const isFileSelected = (eventId: string): boolean => selectedFileIds.includes(eventId);

    const allVisibleFilesSelected =
        visibleSelectedRoomFiles.length > 0
        && visibleSelectedRoomFiles.every((item) => selectedFileIds.includes(item.eventId));

    const toggleFileSelection = (eventId: string): void => {
        setSelectedFileIds((prev) => (prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]));
    };

    const toggleSelectAllVisibleFiles = (): void => {
        const visibleIds = visibleSelectedRoomFiles.map((item) => item.eventId);
        if (visibleIds.length === 0) return;
        setSelectedFileIds((prev) => {
            if (visibleIds.every((id) => prev.includes(id))) {
                return prev.filter((id) => !visibleIds.includes(id));
            }
            return Array.from(new Set([...prev, ...visibleIds]));
        });
    };

    const onOpenFileItem = (item: FileLibraryItem): void => {
        const url = getHttpFileUrl(item);
        if (!url) return;
        traceEvent("files.download", {
            roomId: item.roomId,
            eventId: item.eventId,
            fileName: item.body,
        });
        void (async () => {
            try {
                const blob = await fetchMediaBlob(url, matrixAccessToken);
                const blobUrl = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = blobUrl;
                anchor.download = item.body || "file";
                anchor.rel = "noopener noreferrer";
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
                URL.revokeObjectURL(blobUrl);
            } catch {
                setFileActionError(t("layout.fileDownloadFailed", "File download failed."));
            }
        })();
    };

    const onPreviewFileItem = (item: FileLibraryItem): void => {
        const previewType = getFilePreviewType(item);
        const url = getHttpFileUrl(item);
        if (!previewType || !url) return;
        traceEvent("files.preview_open", {
            roomId: item.roomId,
            eventId: item.eventId,
            type: previewType,
            fileName: item.body,
        });
        setFileActionError(null);
        void (async () => {
            try {
                const blob = await fetchMediaBlob(url, matrixAccessToken);
                const previewUrl = previewType === "pdf"
                    ? await blobToDataUrl(blob)
                    : URL.createObjectURL(blob);
                setPreviewZoom(1);
                setPreviewOffset({ x: 0, y: 0 });
                setFilePreview({
                    url: previewUrl,
                    type: previewType,
                    name: item.body,
                    revokeOnClose: previewType !== "pdf",
                });
            } catch {
                setFileActionError(t("layout.filePreviewFailed", "File preview failed."));
            }
        })();
    };

    const onJumpToFileMessage = (item: FileLibraryItem): void => {
        traceEvent("files.jump_to_message", {
            roomId: item.roomId,
            eventId: item.eventId,
            fileName: item.body,
        });
        setActiveRoomId(item.roomId);
        if (item.eventId) setJumpToEventId(item.eventId);
        setActiveTab("chat");
        setMobileView("detail");
    };

    const onDeleteFileItem = async (item: FileLibraryItem): Promise<void> => {
        if (!matrixClient || !matrixCredentials?.user_id) return;
        setFileActionError(null);
        setFileDeletingEventId(item.eventId);
        traceEvent("files.delete_start", {
            roomId: item.roomId,
            eventId: item.eventId,
            fileName: item.body,
        });
        try {
            await matrixClient.redactEvent(item.roomId, item.eventId);
            if (matrixCredentials.hs_url && matrixCredentials.access_token) {
                await cleanupUploadedMedia(matrixCredentials.hs_url, matrixCredentials.access_token, item.mxcUrl);
            }
            const selfLabel = getLocalPart(matrixCredentials.user_id) || matrixCredentials.user_id;
            await matrixClient.sendEvent(item.roomId, MATRIX_EVENT_TYPE_ROOM_MESSAGE as never, {
                msgtype: "m.notice",
                body: t("chat.fileRevokedNotice", { name: selfLabel }),
            } as never);
            setActiveFileMenuEventId(null);
            setSelectedFileIds((prev) => prev.filter((id) => id !== item.eventId));
            setFileLibraryTick((prev) => prev + 1);
            traceEvent("files.delete_success", {
                roomId: item.roomId,
                eventId: item.eventId,
            });
        } catch (error) {
            setFileActionError(mapActionErrorToMessage(t, error, "layout.fileDeleteFailed"));
            traceEvent("files.delete_failed", {
                roomId: item.roomId,
                eventId: item.eventId,
                reason: mapMediaActionError(error),
            });
        } finally {
            setFileDeletingEventId(null);
        }
    };

    const deleteFileRecord = async (
        item: FileLibraryItem,
        options?: { sendNotice?: boolean },
    ): Promise<void> => {
        if (!matrixClient || !matrixCredentials?.user_id) {
            throw new Error("MATRIX_CLIENT_UNAVAILABLE");
        }
        await matrixClient.redactEvent(item.roomId, item.eventId);
        if (matrixCredentials.hs_url && matrixCredentials.access_token) {
            await cleanupUploadedMedia(matrixCredentials.hs_url, matrixCredentials.access_token, item.mxcUrl);
        }
        if (options?.sendNotice === false) {
            return;
        }
        const selfLabel = getLocalPart(matrixCredentials.user_id) || matrixCredentials.user_id;
        await matrixClient.sendEvent(item.roomId, MATRIX_EVENT_TYPE_ROOM_MESSAGE as never, {
            msgtype: "m.notice",
            body: t("chat.fileRevokedNotice", { name: selfLabel }),
        } as never);
    };

    const onDeleteBatchFiles = async (): Promise<void> => {
        if (fileBatchDeleting || !matrixClient) return;
        if (selectedFileIds.length === 0) return;
        const targets = selectedRoomFiles.filter((item) => selectedFileIds.includes(item.eventId));
        if (targets.length === 0) return;
        setFileBatchDeleting(true);
        setFileBatchDeleteProgress({ done: 0, total: targets.length });
        traceEvent("files.batch_delete_start", {
            roomId: selectedFileRoomId,
            selectedCount: selectedFileIds.length,
            targetCount: targets.length,
        });
        let failed = 0;
        let succeeded = 0;
        let mappedError: "STORAGE_QUOTA_EXCEEDED" | "NO_PERMISSION" | "GENERIC" | null = null;

        const queue = [...targets];
        let completed = 0;
        const workerCount = Math.min(FILE_BATCH_DELETE_CONCURRENCY, queue.length);

        const runWorker = async (): Promise<void> => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) return;
                try {
                    await deleteFileRecord(item, { sendNotice: false });
                    succeeded += 1;
                } catch (error) {
                    failed += 1;
                    if (!mappedError) {
                        mappedError = mapMediaActionError(error);
                    }
                } finally {
                    completed += 1;
                    setFileBatchDeleteProgress({ done: completed, total: targets.length });
                }
            }
        };

        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

        if (succeeded > 0 && selectedFileRoomId) {
            const selfLabel = getLocalPart(matrixCredentials?.user_id) || matrixCredentials?.user_id || "user";
            try {
                await matrixClient.sendEvent(selectedFileRoomId, MATRIX_EVENT_TYPE_ROOM_MESSAGE as never, {
                    msgtype: "m.notice",
                    body: t("layout.fileBatchRevokedNotice", {
                        name: selfLabel,
                        count: succeeded,
                        defaultValue: `${selfLabel} revoked ${succeeded} files`,
                    }),
                } as never);
            } catch {
                // Keep batch delete fast; file redactions already succeeded.
            }
        }
        setSelectedFileIds([]);
        setFileBatchMode(false);
        setShowFileToolbarMenu(false);
        setFileLibraryTick((prev) => prev + 1);
        if (failed > 0) {
            setFileActionError(
                mapActionErrorToMessage(t, { errcode: mappedError ?? "GENERIC" }, "layout.fileDeleteFailed"),
            );
            traceEvent("files.batch_delete_partial_failed", {
                roomId: selectedFileRoomId,
                failed,
                success: targets.length - failed,
                reason: mappedError ?? "GENERIC",
            });
        } else {
            setFileActionError(null);
            traceEvent("files.batch_delete_success", {
                roomId: selectedFileRoomId,
                success: targets.length,
            });
        }
        setFileBatchDeleting(false);
        setFileBatchDeleteProgress({ done: 0, total: 0 });
    };

    return (
        <>
            {/* Main file browser content */}
            {!filesReady ? (
                <DeferredModulePanel
                    title="Preparing files"
                    description="The local file index is being restored first so room navigation stays smooth."
                />
            ) : (
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-white dark:bg-slate-900">
                    {!selectedRoomSummary ? (
                        <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                            {t("layout.fileNoRoomSelected")}
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setMobileView("list")}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                                    aria-label={t("layout.backToList")}
                                >
                                    &lt;
                                </button>
                                <div className="min-w-0">
                                    <div className="text-[18px] font-semibold leading-7 text-slate-800 truncate dark:text-slate-100">
                                        {selectedRoomSummary.roomName}
                                    </div>
                                    <div className="text-[14px] leading-5 text-slate-500 dark:text-slate-400">
                                        {t("layout.filesCountLabel", { count: selectedRoomSummary.attachmentCount })}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowFileToolbarMenu((prev) => !prev)}
                                    className="h-10 rounded-xl border border-gray-200 px-3 text-sm text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                >
                                    ...
                                </button>
                            </div>
                            {showFileToolbarMenu && (
                                <div className="mx-6 mt-2 w-40 rounded-xl border border-gray-200 bg-white py-1.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                                    <button
                                        type="button"
                                        disabled={fileBatchDeleting}
                                        className="w-full px-3 py-2 text-left text-slate-600 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
                                        onClick={() => {
                                            if (fileBatchDeleting) return;
                                            setFileBatchMode((prev) => !prev);
                                            setSelectedFileIds([]);
                                            setShowFileToolbarMenu(false);
                                        }}
                                    >
                                        {fileBatchMode ? t("layout.fileBatchCancel") : t("layout.fileBatchSelect")}
                                    </button>
                                </div>
                            )}
                            {fileBatchMode && (
                                <div className="mx-6 mt-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
                                    <span>
                                        {fileBatchDeleting
                                            ? t("layout.fileBatchDeletingProgress", {
                                                done: fileBatchDeleteProgress.done,
                                                total: fileBatchDeleteProgress.total,
                                            })
                                            : t("layout.fileBatchSelectedCount", { count: selectedFileIds.length })}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={toggleSelectAllVisibleFiles}
                                            disabled={fileBatchDeleting || visibleSelectedRoomFiles.length === 0}
                                            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700 dark:bg-slate-900 dark:text-emerald-300 dark:hover:border-emerald-500 dark:hover:bg-emerald-900/30"
                                        >
                                            {allVisibleFilesSelected
                                                ? t("layout.fileBatchDeselectAll", "取消全选")
                                                : t("layout.fileBatchSelectAll", "全选")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void onDeleteBatchFiles()}
                                            disabled={fileBatchDeleting || selectedFileIds.length === 0}
                                            className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {fileBatchDeleting ? t("layout.fileDeletingBusy") : t("layout.fileBatchDelete")}
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div className="px-6 pt-4">
                                {fileHistoryLoadingRoomId === selectedFileRoomId && (
                                    <div className="mb-2 text-sm text-slate-500 dark:text-slate-400">
                                        {t("common.loading")}
                                    </div>
                                )}
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px]">
                                    <input
                                        type="text"
                                        value={fileListSearch}
                                        onChange={(event) => setFileListSearch(event.target.value)}
                                        placeholder={t("layout.filesListSearchPlaceholder")}
                                        className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                    <select
                                        value={fileListTypeFilter}
                                        onChange={(event) =>
                                            setFileListTypeFilter(
                                                event.target.value as "all" | "image" | "video" | "audio" | "pdf" | "other",
                                            )
                                        }
                                        className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-[15px] text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                        <option value="all">{t("layout.fileFilterTypeAll")}</option>
                                        <option value="image">{t("layout.fileFilterTypeImage")}</option>
                                        <option value="video">{t("layout.fileFilterTypeVideo")}</option>
                                        <option value="audio">{t("layout.fileFilterTypeAudio")}</option>
                                        <option value="pdf">{t("layout.fileFilterTypePdf")}</option>
                                        <option value="other">{t("layout.fileFilterTypeOther")}</option>
                                    </select>
                                </div>
                            </div>
                            <div className="hidden px-6 pt-3 pb-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 sm:block">
                                <div className="grid grid-cols-[32px_84px_90px_90px_1fr] gap-2">
                                    <span />
                                    <span>{t("layout.fileColumnPreview")}</span>
                                    <span>{t("layout.fileColumnType")}</span>
                                    <span>{t("layout.fileColumnSize")}</span>
                                    <span>{t("layout.fileColumnActions")}</span>
                                </div>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto gt-visible-scrollbar px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] space-y-2 touch-pan-y">
                                {visibleSelectedRoomFiles.length === 0 ? (
                                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-base text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                                        {t("layout.fileListEmptyInRoom")}
                                    </div>
                                ) : (
                                    pagedVisibleSelectedRoomFiles.map((item) => {
                                        const fileType = getFileTypeGroup(item);
                                        const ext = getFileExtension(item.body, item.mimeType);
                                        return (
                                            <div
                                                key={item.eventId}
                                                onClick={fileBatchMode ? () => toggleFileSelection(item.eventId) : undefined}
                                                className={`flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-950 sm:grid sm:grid-cols-[32px_84px_90px_90px_1fr] sm:items-center sm:gap-3 sm:px-3 sm:py-3 ${
                                                    fileBatchMode ? "cursor-pointer" : ""
                                                }`}
                                            >
                                                <div className={fileBatchMode ? "flex w-6 shrink-0 items-center justify-center" : "hidden items-center justify-center sm:flex"}>
                                                    {fileBatchMode ? (
                                                        <input
                                                            type="checkbox"
                                                            checked={isFileSelected(item.eventId)}
                                                            onChange={() => toggleFileSelection(item.eventId)}
                                                            onClick={(event) => event.stopPropagation()}
                                                            className="h-4 w-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900"
                                                        />
                                                    ) : <span />}
                                                </div>
                                                <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                                                    {fileType === "image" && fileThumbnailUrls[item.eventId] ? (
                                                        <button
                                                            type="button"
                                                            disabled={fileBatchMode}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                if (fileBatchMode) return;
                                                                onPreviewFileItem(item);
                                                            }}
                                                            className="h-full w-full disabled:cursor-default"
                                                        >
                                                            <img src={fileThumbnailUrls[item.eventId]} alt={item.body} className="h-full w-full object-cover" />
                                                        </button>
                                                    ) : fileType === "video" && fileThumbnailUrls[item.eventId] ? (
                                                        <button
                                                            type="button"
                                                            disabled={fileBatchMode}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                if (fileBatchMode) return;
                                                                onPreviewFileItem(item);
                                                            }}
                                                            className="h-full w-full disabled:cursor-default"
                                                        >
                                                            <video src={fileThumbnailUrls[item.eventId]} className="h-full w-full object-cover" muted preload="metadata" />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                if (fileBatchMode || fileType === "other") return;
                                                                onPreviewFileItem(item);
                                                            }}
                                                            disabled={fileBatchMode || fileType === "other"}
                                                            className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-500 disabled:cursor-default dark:text-slate-300"
                                                        >
                                                            {ext}
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1 sm:contents">
                                                    <div className="truncate text-base font-semibold text-slate-700 dark:text-slate-200 sm:hidden">
                                                        {item.body || "file"}
                                                    </div>
                                                    <div className="text-base text-slate-700 dark:text-slate-200 sm:block">{ext}</div>
                                                    <div className="text-sm text-slate-500 dark:text-slate-400 sm:text-base sm:text-slate-700 sm:dark:text-slate-200">
                                                        {item.sizeBytes == null ? "--" : `${formatBytesToMb(item.sizeBytes)} MB`}
                                                    </div>
                                                </div>
                                                <div className="relative ml-auto flex items-center justify-between gap-2 sm:ml-0">
                                                    <div className="hidden min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400 sm:block">
                                                        {new Date(item.ts).toLocaleString()}
                                                    </div>
                                                    {!fileBatchMode && (
                                                        <button
                                                            type="button"
                                                            disabled={fileDeletingEventId === item.eventId || fileBatchDeleting}
                                                            onClick={() => setActiveFileMenuEventId((prev) => (prev === item.eventId ? null : item.eventId))}
                                                            className="rounded-full px-2 text-slate-400 hover:bg-gray-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                                        >
                                                            ...
                                                        </button>
                                                    )}
                                                    {!fileBatchMode && activeFileMenuEventId === item.eventId && (
                                                        <div className="absolute right-0 top-8 z-20 w-32 rounded-xl border border-gray-200 bg-white py-1.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                                                            {getFilePreviewType(item) && (
                                                                <button
                                                                    type="button"
                                                                    className="w-full px-3 py-2 text-left text-slate-600 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
                                                                    onClick={() => {
                                                                        setActiveFileMenuEventId(null);
                                                                        onPreviewFileItem(item);
                                                                    }}
                                                                >
                                                                    {t("layout.fileActionPreview")}
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                className="w-full px-3 py-2 text-left text-slate-600 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
                                                                onClick={() => {
                                                                    setActiveFileMenuEventId(null);
                                                                    onOpenFileItem(item);
                                                                }}
                                                            >
                                                                {t("layout.fileActionDownload")}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="w-full px-3 py-2 text-left text-slate-600 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
                                                                onClick={() => {
                                                                    setActiveFileMenuEventId(null);
                                                                    onJumpToFileMessage(item);
                                                                }}
                                                            >
                                                                {t("layout.fileActionJump")}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={fileDeletingEventId === item.eventId || fileBatchDeleting}
                                                                className="w-full px-3 py-2 text-left text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300 dark:hover:bg-slate-800"
                                                                onClick={() => void onDeleteFileItem(item)}
                                                            >
                                                                {fileDeletingEventId === item.eventId
                                                                    ? t("layout.fileDeletingBusy")
                                                                    : t("layout.fileActionDelete")}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                {canLoadMoreFiles && (
                                    <button
                                        type="button"
                                        onClick={() => setFileListPage((prev) => prev + 1)}
                                        className="mx-auto block rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-slate-600 hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300"
                                    >
                                        {t("layout.fileLoadMore", {
                                            shown: pagedVisibleSelectedRoomFiles.length,
                                            total: visibleSelectedRoomFiles.length,
                                        })}
                                    </button>
                                )}
                            </div>
                            {fileActionError && (
                                <div className="px-6 pb-4 text-sm text-rose-500">{fileActionError}</div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* File preview overlay */}
            {filePreview && (
                <div
                    className={`fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 ${
                        isMobileApp
                            ? "py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
                            : "py-6"
                    }`}
                    onClick={closeFilePreview}
                    onTouchEnd={isMobileApp ? closeFilePreview : undefined}
                    onMouseMove={(event) => {
                        if (!previewDraggingRef.current) return;
                        const dx = event.clientX - previewDragStartRef.current.x;
                        const dy = event.clientY - previewDragStartRef.current.y;
                        setPreviewOffset({
                            x: previewDragOriginRef.current.x + dx,
                            y: previewDragOriginRef.current.y + dy,
                        });
                    }}
                    onMouseUp={() => {
                        previewDraggingRef.current = false;
                    }}
                    onMouseLeave={() => {
                        previewDraggingRef.current = false;
                    }}
                >
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            closeFilePreview();
                        }}
                        onTouchEnd={isMobileApp
                            ? (event) => {
                                event.stopPropagation();
                                closeFilePreview();
                            }
                            : undefined}
                        className={`absolute rounded-full bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20 ${
                            isMobileApp
                                ? "right-4 top-[max(1rem,env(safe-area-inset-top))]"
                                : "right-6 top-6"
                        }`}
                    >
                        {t("common.close")}
                    </button>
                    {filePreview.type === "image" ? (
                        <div
                            className={`overflow-hidden rounded-xl bg-black/30 cursor-grab ${
                                isMobileApp
                                    ? "max-h-[min(82vh,calc(100svh-5rem))] max-w-[min(92vw,42rem)]"
                                    : "max-h-[90vh] max-w-[90vw]"
                            }`}
                            onClick={(event) => event.stopPropagation()}
                            onTouchEnd={isMobileApp ? (event) => event.stopPropagation() : undefined}
                            onMouseDown={(event) => {
                                previewDraggingRef.current = true;
                                previewDragStartRef.current = { x: event.clientX, y: event.clientY };
                                previewDragOriginRef.current = previewOffset;
                            }}
                            onWheel={(event) => {
                                event.preventDefault();
                                const next = Math.min(3, Math.max(0.5, previewZoom - event.deltaY * 0.001));
                                setPreviewZoom(next);
                            }}
                        >
                            <img
                                src={filePreview.url}
                                alt={filePreview.name}
                                className={`select-none ${
                                    isMobileApp
                                        ? "max-h-[min(82vh,calc(100svh-5rem))] max-w-[min(92vw,42rem)]"
                                        : "max-h-[90vh] max-w-[90vw]"
                                }`}
                                style={{
                                    transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewZoom})`,
                                    transition: previewDraggingRef.current ? "none" : "transform 120ms ease",
                                }}
                                draggable={false}
                            />
                        </div>
                    ) : filePreview.type === "pdf" ? (
                        <div
                            className={`overflow-hidden rounded-xl bg-white ${
                                isMobileApp
                                    ? "h-[min(82vh,calc(100svh-5rem))] w-[min(92vw,42rem)]"
                                    : "h-[90vh] w-[90vw]"
                            }`}
                            onClick={(event) => event.stopPropagation()}
                            onTouchEnd={isMobileApp ? (event) => event.stopPropagation() : undefined}
                        >
                            <iframe src={filePreview.url} title={filePreview.name} className="h-full w-full bg-white" />
                        </div>
                    ) : filePreview.type === "audio" ? (
                        <div
                            className="w-full max-w-xl rounded-xl bg-slate-900 p-6"
                            onClick={(event) => event.stopPropagation()}
                            onTouchEnd={isMobileApp ? (event) => event.stopPropagation() : undefined}
                        >
                            <div className="mb-3 text-sm text-slate-200">{filePreview.name}</div>
                            <audio src={filePreview.url} controls autoPlay className="w-full" />
                        </div>
                    ) : (
                        <video
                            src={filePreview.url}
                            controls
                            autoPlay
                            className={`rounded-xl bg-black ${
                                isMobileApp
                                    ? "max-h-[min(82vh,calc(100svh-5rem))] max-w-[min(92vw,42rem)]"
                                    : "max-h-[90vh] max-w-[90vw]"
                            }`}
                            onClick={(event) => event.stopPropagation()}
                            onTouchEnd={isMobileApp ? (event) => event.stopPropagation() : undefined}
                        />
                    )}
                </div>
            )}
        </>
    );
};

export default FileCenterPanel;
