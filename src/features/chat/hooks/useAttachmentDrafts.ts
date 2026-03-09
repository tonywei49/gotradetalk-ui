import { useEffect, useMemo, useRef, useState } from "react";
import { MsgType } from "matrix-js-sdk";

const PENDING_ATTACHMENT_DRAFTS_KEY_PREFIX = "gtt_pending_attachment_drafts_v1";

export type PendingAttachment = {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    durationMs?: number;
    sourceFile?: File;
    msgtype: MsgType;
    isPdf: boolean;
    mxcUrl: string | null;
    progress: number;
    status: "uploading" | "ready" | "failed" | "removing";
    error?: string;
};

type PersistedPendingAttachment = {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    durationMs?: number;
    msgtype: MsgType;
    isPdf: boolean;
    mxcUrl: string | null;
    status: "ready" | "failed";
    progress: number;
    error?: string;
};

function getPendingAttachmentDraftsKey(userId: string): string {
    return `${PENDING_ATTACHMENT_DRAFTS_KEY_PREFIX}:${userId}`;
}

function readPersistedPendingAttachments(userId: string): Record<string, PersistedPendingAttachment[]> {
    try {
        const raw = localStorage.getItem(getPendingAttachmentDraftsKey(userId));
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, PersistedPendingAttachment[]>;
        if (!parsed || typeof parsed !== "object") return {};
        const out: Record<string, PersistedPendingAttachment[]> = {};
        Object.entries(parsed).forEach(([roomId, items]) => {
            if (!Array.isArray(items)) return;
            const filtered = items.filter(
                (item) =>
                    item &&
                    typeof item.id === "string" &&
                    typeof item.fileName === "string" &&
                    typeof item.fileSize === "number" &&
                    typeof item.mimeType === "string" &&
                    (typeof item.durationMs === "number" || typeof item.durationMs === "undefined") &&
                    typeof item.msgtype === "string" &&
                    typeof item.isPdf === "boolean" &&
                    (typeof item.mxcUrl === "string" || item.mxcUrl === null) &&
                    (item.status === "ready" || item.status === "failed"),
            );
            if (filtered.length > 0) out[roomId] = filtered;
        });
        return out;
    } catch {
        return {};
    }
}

function writePersistedPendingAttachments(
    userId: string,
    value: Record<string, PersistedPendingAttachment[]>,
): void {
    localStorage.setItem(getPendingAttachmentDraftsKey(userId), JSON.stringify(value));
}

export function buildUploadRetryKey(roomId: string, attachmentId: string): string {
    return `${roomId}::${attachmentId}`;
}

export function parseUploadRetryKey(key: string): { roomId: string; attachmentId: string } | null {
    const split = key.split("::");
    if (split.length !== 2) return null;
    const roomId = split[0];
    const attachmentId = split[1];
    if (!roomId || !attachmentId) return null;
    return { roomId, attachmentId };
}

export function useAttachmentDrafts(params: {
    userId: string | null;
    activeRoomId: string | null;
    uploadInterruptedNeedsReselectText: string;
}) {
    const { userId, activeRoomId, uploadInterruptedNeedsReselectText } = params;
    const [pendingAttachmentsByRoom, setPendingAttachmentsByRoom] = useState<Record<string, PendingAttachment[]>>({});
    const [retryUploadQueue, setRetryUploadQueue] = useState<string[]>([]);
    const retryAttemptsRef = useRef<Record<string, number>>({});
    const [retryPickTarget, setRetryPickTarget] = useState<{ roomId: string; attachmentId: string } | null>(null);
    const [networkOnline, setNetworkOnline] = useState<boolean>(() => {
        if (typeof navigator === "undefined") return true;
        return navigator.onLine;
    });

    const pendingAttachments = useMemo(
        () => (activeRoomId ? pendingAttachmentsByRoom[activeRoomId] ?? [] : []),
        [activeRoomId, pendingAttachmentsByRoom],
    );
    const hasPendingUpload = pendingAttachments.some((item) => item.status === "uploading");

    useEffect(() => {
        if (!userId) return;
        const persisted = readPersistedPendingAttachments(userId);
        const restored: Record<string, PendingAttachment[]> = {};
        Object.entries(persisted).forEach(([roomId, items]) => {
            restored[roomId] = items.map((item) => ({
                id: item.id,
                fileName: item.fileName,
                fileSize: item.fileSize,
                mimeType: item.mimeType,
                durationMs: item.durationMs,
                sourceFile: undefined,
                msgtype: item.msgtype,
                isPdf: item.isPdf,
                mxcUrl: item.mxcUrl,
                progress: item.progress,
                status: item.status,
                error: item.status === "failed" ? item.error || uploadInterruptedNeedsReselectText : undefined,
            }));
        });
        setPendingAttachmentsByRoom(restored);
    }, [uploadInterruptedNeedsReselectText, userId]);

    useEffect(() => {
        if (!userId) return;
        const persisted: Record<string, PersistedPendingAttachment[]> = {};
        Object.entries(pendingAttachmentsByRoom).forEach(([roomId, items]) => {
            const persistedItems: PersistedPendingAttachment[] = [];
            items
                .filter((item) => item.status === "ready" || item.status === "failed")
                .forEach((item) => {
                    const isReady = item.status === "ready" && Boolean(item.mxcUrl);
                    const nextItem: PersistedPendingAttachment = {
                        id: item.id,
                        fileName: item.fileName,
                        fileSize: item.fileSize,
                        mimeType: item.mimeType,
                        durationMs: item.durationMs,
                        msgtype: item.msgtype,
                        isPdf: item.isPdf,
                        mxcUrl: isReady ? (item.mxcUrl as string) : null,
                        status: (isReady ? "ready" : "failed") as "ready" | "failed",
                        progress: item.progress,
                        error: isReady ? undefined : item.error || uploadInterruptedNeedsReselectText,
                    };
                    persistedItems.push(nextItem);
                });
            if (persistedItems.length > 0) persisted[roomId] = persistedItems;
        });
        writePersistedPendingAttachments(userId, persisted);
    }, [pendingAttachmentsByRoom, uploadInterruptedNeedsReselectText, userId]);

    useEffect(() => {
        const onOnline = (): void => setNetworkOnline(true);
        const onOffline = (): void => setNetworkOnline(false);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);

    return {
        pendingAttachmentsByRoom,
        setPendingAttachmentsByRoom,
        pendingAttachments,
        hasPendingUpload,
        retryUploadQueue,
        setRetryUploadQueue,
        retryAttemptsRef,
        retryPickTarget,
        setRetryPickTarget,
        networkOnline,
    };
}
