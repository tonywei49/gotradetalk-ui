import React, { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
    MagnifyingGlassIcon,
    EllipsisVerticalIcon,
    FaceSmileIcon,
    PaperClipIcon,
    MicrophoneIcon,
    ChevronLeftIcon,
} from "@heroicons/react/24/outline";
import { PaperAirplaneIcon, ChevronDownIcon } from "@heroicons/react/24/solid";
import type { MatrixEvent } from "matrix-js-sdk";
import { EventStatus, EventType, MsgType } from "matrix-js-sdk";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../stores/AuthStore";
import { useRoomTimeline } from "../../matrix/hooks/useRoomTimeline";
import { inviteUsersToRoom, updateRoomInvitePermission } from "../../services/matrix";
import { listContacts, type ContactEntry } from "../../api/contacts";
import { hubTranslate } from "../../api/hub";
import { DEPRECATED_DM_PREFIX } from "../../constants/rooms";
import { ROOM_KIND_DIRECT, ROOM_KIND_EVENT, ROOM_KIND_GROUP } from "../../constants/roomKinds";
import { traceEvent } from "../../utils/debugTrace";
import { mapActionErrorToMessage } from "../../utils/errorMessages";
import { useToastStore } from "../../stores/ToastStore";

const EMOJI_LIST: string[] = [
    "😀", "😃", "😄", "😁", "😆", "😊", "🙂", "😉", "😍", "😘", "😎", "🤩",
    "👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "🫶", "🤔", "🤗", "🎉", "🔥",
    "🌞", "🌙", "⭐", "🌈", "☔", "❄", "🌊", "🌸", "🌻", "🍀", "🌲", "🌍",
    "🍎", "🍌", "🍓", "🍇", "🍑", "🍕", "🍔", "🍟", "🍜", "🍣", "☕", "🍺",
    "❤️", "🧡", "💛", "💚", "💙", "💜", "✅", "❌", "⚠️", "❓", "💬", "📌",
];

type MessageBubbleProps = {
    event: MatrixEvent;
    isMe: boolean;
    status: EventStatus | null;
    onResend: (event: MatrixEvent) => void;
    mediaUrl: string | null;
    senderLabel: string;
    onOpenMedia: (payload: { url: string; type: "image" | "video" | "pdf" }) => void;
    translatedText?: string | null;
    showTranslation?: boolean;
    translationLoading?: boolean;
    translationError?: boolean;
    onToggleTranslation?: () => void;
    canDeleteFile?: boolean;
    deleteBusy?: boolean;
    onDeleteFile?: (event: MatrixEvent) => void;
};

type PendingAttachment = {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    sourceFile?: File;
    msgtype: MsgType;
    isPdf: boolean;
    mxcUrl: string | null;
    progress: number;
    status: "uploading" | "ready" | "failed" | "removing";
    error?: string;
};

const DRAFT_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_MEDIA_REGISTRY_KEY = "gtt_draft_media_registry_v1";
const PENDING_ATTACHMENT_DRAFTS_KEY_PREFIX = "gtt_pending_attachment_drafts_v1";
const UPLOAD_RETRY_INTERVAL_MS = 3000;
const UPLOAD_RETRY_MAX_ATTEMPTS = 3;
const TRANSLATION_CACHE_STORAGE_KEY = "gtt_translation_cache_v1";
const TRANSLATION_CACHE_MAX_ITEMS = 1500;

type DraftMediaRegistryEntry = {
    mxcUrl: string;
    createdAt: number;
    ownerUserId: string;
};

type PersistedPendingAttachment = {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    msgtype: MsgType;
    isPdf: boolean;
    mxcUrl: string | null;
    status: "ready" | "failed";
    progress: number;
    error?: string;
};

type PersistedTranslationCacheEntry = {
    text: string;
    updatedAt: number;
};

type PersistedTranslationCacheRecord = Record<string, PersistedTranslationCacheEntry>;

function hashTextForTranslationCache(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 33) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

function buildTranslationCacheStorageKey(
    roomId: string,
    messageId: string,
    targetLanguage: string,
    sourceText: string,
): string {
    return `${roomId}|${messageId}|${targetLanguage}|${hashTextForTranslationCache(sourceText)}`;
}

const MessageMarkdown = ({ text, isMe }: { text: string; isMe: boolean }) => {
    const textClass = isMe ? "text-white" : "text-slate-800 dark:text-slate-100";
    const mutedTextClass = isMe ? "text-emerald-100/80" : "text-slate-500 dark:text-slate-400";
    const borderClass = isMe ? "border-white/20" : "border-slate-300/60 dark:border-slate-600";
    const tableHeaderClass = isMe ? "bg-white/10" : "bg-slate-100 dark:bg-slate-700";
    const codeClass = isMe
        ? "rounded bg-white/15 px-1 py-0.5 text-[12px] text-white"
        : "rounded bg-slate-100 px-1 py-0.5 text-[12px] text-slate-700 dark:bg-slate-700 dark:text-slate-100";
    const preClass = isMe
        ? "my-2 overflow-x-auto rounded-lg bg-black/20 p-2 text-[12px] text-white"
        : "my-2 overflow-x-auto rounded-lg bg-slate-100 p-2 text-[12px] text-slate-700 dark:bg-slate-700 dark:text-slate-100";

    return (
        <div className="max-w-full break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                    p: ({ children }) => <p className="my-1 last:mb-0">{children}</p>,
                    br: () => <br />,
                    ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
                    ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
                    li: ({ children }) => <li className="my-0.5">{children}</li>,
                    blockquote: ({ children }) => (
                        <blockquote className={`my-2 border-l-2 pl-2 italic ${borderClass} ${mutedTextClass}`}>{children}</blockquote>
                    ),
                    code: ({ children }) => <code className={codeClass}>{children}</code>,
                    pre: ({ children }) => <pre className={preClass}>{children}</pre>,
                    table: ({ children }) => (
                        <div className="my-2 overflow-x-auto">
                            <table className={`min-w-full border-collapse text-left text-[12px] ${textClass}`}>{children}</table>
                        </div>
                    ),
                    thead: ({ children }) => <thead className={tableHeaderClass}>{children}</thead>,
                    tbody: ({ children }) => <tbody>{children}</tbody>,
                    tr: ({ children }) => <tr className={`border-b ${borderClass}`}>{children}</tr>,
                    th: ({ children }) => <th className={`border px-2 py-1 font-semibold ${borderClass}`}>{children}</th>,
                    td: ({ children }) => <td className={`border px-2 py-1 align-top ${borderClass}`}>{children}</td>,
                    a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noreferrer" className="underline">
                            {children}
                        </a>
                    )
                }}
            >
                {text}
            </ReactMarkdown>
        </div>
    );
};

const TranslationTypingIndicator = ({ isMe }: { isMe: boolean }) => {
    const dotClass = isMe ? "bg-white/90" : "bg-slate-500 dark:bg-slate-300";
    return (
        <div className="flex items-center gap-1 px-1 py-1" aria-label="translation-loading-indicator">
            <span className={`h-1.5 w-1.5 rounded-full animate-bounce ${dotClass}`} />
            <span className={`h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:120ms] ${dotClass}`} />
            <span className={`h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:240ms] ${dotClass}`} />
        </div>
    );
};

const MessageBubble = ({
    event,
    isMe,
    status,
    onResend,
    mediaUrl,
    senderLabel,
    onOpenMedia,
    translatedText,
    showTranslation,
    translationLoading,
    translationError,
    onToggleTranslation,
    canDeleteFile,
    deleteBusy,
    onDeleteFile,
}: MessageBubbleProps) => {
    const { t } = useTranslation();
    const [showFileMenu, setShowFileMenu] = useState(false);
    const content = event.getContent() as { body?: string; msgtype?: string; info?: { mimetype?: string } } | undefined;
    const messageText = content?.body ?? "";
    const isSending =
        status === EventStatus.SENDING || status === EventStatus.ENCRYPTING || status === EventStatus.QUEUED;
    const isFailed = status === EventStatus.NOT_SENT;
    const timeLabel = new Date(event.getTs()).toLocaleTimeString();
    const isImageMsg = content?.msgtype === MsgType.Image;
    const isVideoMsg = content?.msgtype === MsgType.Video;
    const isAudioMsg = content?.msgtype === MsgType.Audio;
    const isFile = content?.msgtype === MsgType.File;
    const isImage = isImageMsg && mediaUrl;
    const isVideo = isVideoMsg && mediaUrl;
    const isAudio = isAudioMsg && mediaUrl;
    const isPdf =
        Boolean(isFile) &&
        ((content?.info?.mimetype ?? "").toLowerCase().includes("application/pdf") ||
            messageText.toLowerCase().endsWith(".pdf"));
    const isText = !isImage && !isVideo && !isAudio && !isFile;
    const isFileLike = Boolean(isImageMsg || isVideoMsg || isAudioMsg || isFile);
    const eventId = event.getId() ?? event.getTxnId() ?? "unknown";
    const showTranslated = Boolean(isText && showTranslation);
    const hasTranslatedText = Boolean((translatedText ?? "").trim());
    const showUnavailableInline = Boolean(
        isText && showTranslated && !translationLoading && !hasTranslatedText && translationError,
    );
    const displayText = showTranslated
        ? hasTranslatedText
            ? (translatedText as string)
            : translationLoading
                ? t("chat.translationPending")
                : messageText
        : messageText;

    return (
        <div className={`flex w-full mb-3 ${isMe ? "justify-end" : "justify-start"} ${isSending ? "opacity-60" : ""}`}>
            {/* Avatar (Incoming only) */}
            {!isMe && <div className="w-8 h-8 rounded-full bg-gray-300 mr-3 flex-shrink-0 self-start mt-1" />}

            <div className={`flex flex-col max-w-[70%] ${isMe ? "items-end" : "items-start"}`}>
                {/* Sender Name (Incoming only) */}
                {!isMe && (
                    <span className="text-[11px] text-gray-500 mb-1 ml-1 dark:text-slate-400">{senderLabel}</span>
                )}

                <div className="flex items-end gap-2">
                    {/* Read Status & Time (Outgoing: Left of bubble) */}
                    {isMe && (
                        <div className="flex flex-col items-end justify-end text-[9px] text-gray-400 min-w-[56px] mb-1">
                            {isFailed && <span className="text-rose-500 font-medium">{t("chat.failed")}</span>}
                            <span className="text-gray-400 dark:text-slate-500">{timeLabel}</span>
                        </div>
                    )}
                    {isMe && isFileLike && canDeleteFile && onDeleteFile && (
                        <div className="relative self-end mb-1">
                            <button
                                type="button"
                                data-testid={`chat-file-action-trigger-${eventId}`}
                                onClick={() => setShowFileMenu((prev) => !prev)}
                                className="rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                aria-label={t("chat.fileActions")}
                                disabled={deleteBusy}
                            >
                                <EllipsisVerticalIcon className="h-4 w-4" />
                            </button>
                            {showFileMenu && (
                                <div className="absolute right-0 z-20 mt-1 w-24 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                                    <button
                                        type="button"
                                        data-testid={`chat-file-delete-${eventId}`}
                                        className="w-full px-3 py-1.5 text-left text-rose-500 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-slate-800"
                                        onClick={() => {
                                            setShowFileMenu(false);
                                            onDeleteFile(event);
                                        }}
                                        disabled={deleteBusy}
                                    >
                                        {deleteBusy ? t("common.loading") : t("chat.deleteFileAction")}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Bubble */}
                    <div
                        className={`
              px-3 py-2 text-[13px] leading-relaxed shadow-sm relative
              ${isMe
                                ? "bg-[#2F5C56] text-white rounded-2xl rounded-tr-sm"
                                : "bg-white text-slate-800 rounded-2xl rounded-tl-sm border border-gray-100 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700"
                            }
            `}
                    >
                        {isImage ? (
                            <button
                                type="button"
                                onClick={() => onOpenMedia({ url: mediaUrl, type: "image" })}
                                className="block"
                            >
                                <img
                                    src={mediaUrl}
                                    alt={messageText || t("chat.imageAlt")}
                                    className="max-w-[280px] rounded-lg"
                                />
                            </button>
                        ) : isVideo ? (
                            <button
                                type="button"
                                onClick={() => onOpenMedia({ url: mediaUrl, type: "video" })}
                                className="relative block max-w-[320px]"
                            >
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="rounded-full bg-black/50 px-3 py-2 text-xs text-white">
                                        {t("chat.playVideo")}
                                    </div>
                                </div>
                                <video
                                    src={mediaUrl}
                                    className="max-w-[320px] rounded-lg opacity-80"
                                    muted
                                    preload="metadata"
                                />
                            </button>
                        ) : isAudio ? (
                            <audio src={mediaUrl} controls className="w-64" />
                        ) : isFile && mediaUrl ? (
                            isPdf ? (
                                <button
                                    type="button"
                                    onClick={() => onOpenMedia({ url: mediaUrl, type: "pdf" })}
                                    className={`rounded-lg px-3 py-2 text-left underline ${
                                        isMe ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100"
                                    }`}
                                >
                                    {t("chat.previewPdf")} {messageText}
                                </button>
                            ) : (
                                <a
                                    href={mediaUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`rounded-lg px-3 py-2 underline ${
                                        isMe ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100"
                                    }`}
                                >
                                    {t("chat.downloadFile")} {messageText}
                                </a>
                            )
                        ) : isText && showTranslated && translationLoading ? (
                            <TranslationTypingIndicator isMe={isMe} />
                        ) : (
                            <MessageMarkdown text={displayText} isMe={isMe} />
                        )}
                    </div>

                    {/* Time (Incoming: Right of bubble) */}
                    {!isMe && (
                        <span className="text-[9px] text-gray-400 self-end mb-1 dark:text-slate-500">{timeLabel}</span>
                    )}
                    {!isMe && isFileLike && canDeleteFile && onDeleteFile && (
                        <div className="relative self-end mb-1">
                            <button
                                type="button"
                                data-testid={`chat-file-action-trigger-${eventId}`}
                                onClick={() => setShowFileMenu((prev) => !prev)}
                                className="rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                aria-label={t("chat.fileActions")}
                                disabled={deleteBusy}
                            >
                                <EllipsisVerticalIcon className="h-4 w-4" />
                            </button>
                            {showFileMenu && (
                                <div className="absolute right-0 z-20 mt-1 w-24 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                                    <button
                                        type="button"
                                        data-testid={`chat-file-delete-${eventId}`}
                                        className="w-full px-3 py-1.5 text-left text-rose-500 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-slate-800"
                                        onClick={() => {
                                            setShowFileMenu(false);
                                            onDeleteFile(event);
                                        }}
                                        disabled={deleteBusy}
                                    >
                                        {deleteBusy ? t("common.loading") : t("chat.deleteFileAction")}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            {isText && !isMe && onToggleTranslation && (
                <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <button
                        type="button"
                        className={`${isMe ? "text-emerald-100/80" : "text-emerald-600 dark:text-emerald-300"}`}
                        onClick={onToggleTranslation}
                        disabled={translationLoading}
                    >
                        {translationLoading
                            ? t("chat.translationPending")
                            : showTranslated
                                ? t("chat.showOriginal")
                                : t("chat.showTranslation")}
                    </button>
                    {showUnavailableInline && (
                        <span className={`${isMe ? "text-emerald-100/80" : "text-emerald-600 dark:text-emerald-300"}`}>
                            {t("chat.translationUnavailable")}
                        </span>
                    )}
                </div>
            )}
            {isFailed && (
                <button
                    type="button"
                    className="mt-2 text-[11px] text-rose-500 hover:text-rose-400"
                        onClick={() => onResend(event)}
                    >
                        {t("chat.resend")}
                    </button>
                )}
            </div>
        </div>
    );
};

type ChatRoomContext = {
    activeRoomId: string | null;
    onMobileBack?: () => void;
    onHideRoom?: () => void;
    onTogglePin?: () => void;
    isRoomPinned?: boolean;
    chatReceiveLanguage?: string;
    translationDefaultView?: "translated" | "original";
    companyName?: string | null;
    jumpToEventId?: string | null;
    onJumpHandled?: () => void;
};

type PowerLevelContent = {
    invite?: number;
    users?: Record<string, number>;
    users_default?: number;
};

type RemoveTarget = {
    userId: string;
    label: string;
    membership: "join" | "invite";
};

function formatNoticeTimestamp(ts: number): string {
    const date = new Date(ts);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

function parseMxcUri(mxcUrl: string): { serverName: string; mediaId: string } | null {
    const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(mxcUrl);
    if (!match) return null;
    return { serverName: match[1], mediaId: match[2] };
}

function withUpdatedRoomAttachments(
    prev: Record<string, PendingAttachment[]>,
    roomId: string,
    updater: (items: PendingAttachment[]) => PendingAttachment[],
): Record<string, PendingAttachment[]> {
    const current = prev[roomId] ?? [];
    const nextItems = updater(current);
    const next: Record<string, PendingAttachment[]> = { ...prev };
    if (nextItems.length === 0) {
        delete next[roomId];
    } else {
        next[roomId] = nextItems;
    }
    return next;
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

function readDraftMediaRegistry(): DraftMediaRegistryEntry[] {
    try {
        const raw = localStorage.getItem(DRAFT_MEDIA_REGISTRY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as DraftMediaRegistryEntry[];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (item) =>
                item &&
                typeof item.mxcUrl === "string" &&
                typeof item.createdAt === "number" &&
                typeof item.ownerUserId === "string",
        );
    } catch {
        return [];
    }
}

function writeDraftMediaRegistry(items: DraftMediaRegistryEntry[]): void {
    localStorage.setItem(DRAFT_MEDIA_REGISTRY_KEY, JSON.stringify(items));
}

function upsertDraftMediaEntry(entry: DraftMediaRegistryEntry): void {
    const prev = readDraftMediaRegistry();
    const next = prev.filter((item) => item.mxcUrl !== entry.mxcUrl);
    next.push(entry);
    writeDraftMediaRegistry(next);
}

function removeDraftMediaEntries(mxcUrls: string[]): void {
    if (mxcUrls.length === 0) return;
    const removalSet = new Set(mxcUrls);
    const prev = readDraftMediaRegistry();
    const next = prev.filter((item) => !removalSet.has(item.mxcUrl));
    writeDraftMediaRegistry(next);
}

function getPendingAttachmentDraftsKey(userId: string): string {
    return `${PENDING_ATTACHMENT_DRAFTS_KEY_PREFIX}:${userId}`;
}

function buildUploadRetryKey(roomId: string, attachmentId: string): string {
    return `${roomId}::${attachmentId}`;
}

function parseUploadRetryKey(key: string): { roomId: string; attachmentId: string } | null {
    const split = key.split("::");
    if (split.length !== 2) return null;
    const roomId = split[0];
    const attachmentId = split[1];
    if (!roomId || !attachmentId) return null;
    return { roomId, attachmentId };
}

function isTransientUploadError(error: unknown): boolean {
    const maybeObj = error as { errcode?: string; message?: string } | null;
    const errcode = typeof maybeObj?.errcode === "string" ? maybeObj.errcode : "";
    const message =
        typeof maybeObj?.message === "string" ? maybeObj.message : error instanceof Error ? error.message : String(error ?? "");
    const normalized = `${errcode} ${message}`.toUpperCase();
    return (
        normalized.includes("NETWORK") ||
        normalized.includes("FAILED TO FETCH") ||
        normalized.includes("ECONN") ||
        normalized.includes("TIMEOUT") ||
        normalized.includes("ETIMEDOUT") ||
        normalized.includes("CONNECTION")
    );
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

export const ChatRoom: React.FC = () => {
    const { t } = useTranslation();
    const pushToast = useToastStore((state) => state.pushToast);
    const {
        activeRoomId,
        onMobileBack,
        onHideRoom,
        onTogglePin,
        isRoomPinned,
        chatReceiveLanguage,
        translationDefaultView,
        companyName,
        jumpToEventId,
        onJumpHandled,
    } =
        useOutletContext<ChatRoomContext>();
    const matrixClient = useAuthStore((state) => state.matrixClient);
    const matrixCredentials = useAuthStore((state) => state.matrixCredentials);
    const userId = useAuthStore((state) => state.matrixCredentials?.user_id ?? null);
    const hubSession = useAuthStore((state) => state.hubSession);
    const userType = useAuthStore((state) => state.userType);
    const { events, room } = useRoomTimeline(matrixClient, activeRoomId, { limit: 200 });
    const timelineRef = useRef<HTMLDivElement | null>(null);
    const roomStickBottomRef = useRef<Record<string, boolean>>({});
    const previousRoomIdRef = useRef<string | null>(null);
    const [composerText, setComposerText] = useState("");
    const [scrollLoading, setScrollLoading] = useState(false);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [showActionsMenu, setShowActionsMenu] = useState(false);
    const [showMembersModal, setShowMembersModal] = useState(false);
    const [showInviteSettingsModal, setShowInviteSettingsModal] = useState(false);
    const [showInviteMembersModal, setShowInviteMembersModal] = useState(false);
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
    const [memberToRemove, setMemberToRemove] = useState<RemoveTarget | null>(null);
    const [removeMemberBusy, setRemoveMemberBusy] = useState(false);
    const [removeMemberError, setRemoveMemberError] = useState<string | null>(null);
    const [showRoomInfoModal, setShowRoomInfoModal] = useState(false);
    const [mediaPreview, setMediaPreview] = useState<{ url: string; type: "image" | "video" | "pdf" } | null>(null);
    const [mediaZoom, setMediaZoom] = useState(1);
    const [mediaOffset, setMediaOffset] = useState({ x: 0, y: 0 });
    const draggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const dragOriginRef = useRef({ x: 0, y: 0 });
    const [inviteAllowed, setInviteAllowed] = useState(true);
    const [inviteBusy, setInviteBusy] = useState(false);
    const [inviteError, setInviteError] = useState<string | null>(null);
    const [contacts, setContacts] = useState<ContactEntry[]>([]);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactsError, setContactsError] = useState<string | null>(null);
    const [contactFilter, setContactFilter] = useState("");
    const [translationContactsLoaded, setTranslationContactsLoaded] = useState(false);
    const [selectedInviteIds, setSelectedInviteIds] = useState<Set<string>>(new Set());
    const [inviteMemberBusy, setInviteMemberBusy] = useState(false);
    const [inviteMemberError, setInviteMemberError] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [renameBusy, setRenameBusy] = useState(false);
    const [renameError, setRenameError] = useState<string | null>(null);
    const [showEmojiBoard, setShowEmojiBoard] = useState(false);
    const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
    const actionsMenuRef = useRef<HTMLDivElement | null>(null);
    const actionsButtonRef = useRef<HTMLButtonElement | null>(null);
    const emojiBoardRef = useRef<HTMLDivElement | null>(null);
    const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
    const composerRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const retryFileInputRef = useRef<HTMLInputElement | null>(null);
    const [pendingAttachmentsByRoom, setPendingAttachmentsByRoom] = useState<Record<string, PendingAttachment[]>>({});
    const [retryUploadQueue, setRetryUploadQueue] = useState<string[]>([]);
    const retryAttemptsRef = useRef<Record<string, number>>({});
    const [retryPickTarget, setRetryPickTarget] = useState<{ roomId: string; attachmentId: string } | null>(null);
    const [networkOnline, setNetworkOnline] = useState<boolean>(() => {
        if (typeof navigator === "undefined") return true;
        return navigator.onLine;
    });
    const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
    const hubAccessToken = hubSession?.access_token ?? null;
    const hubSessionExpiresAt = hubSession?.expires_at ?? null;
    const matrixAccessToken = matrixCredentials?.access_token ?? null;
    const matrixHsUrl = matrixCredentials?.hs_url ?? null;
    const inviteTokenExpired = hubSessionExpiresAt ? hubSessionExpiresAt * 1000 <= Date.now() : false;
    const useHubToken = userType === "client" && hubAccessToken && !inviteTokenExpired;
    const inviteAccessToken = useHubToken ? hubAccessToken : matrixAccessToken;
    const inviteHsUrl = useHubToken ? null : matrixHsUrl;
    const translateAccessToken = hubAccessToken ?? matrixAccessToken;
    const translateHsUrl = hubAccessToken ? null : matrixHsUrl;
    const translateMatrixUserId = matrixCredentials?.user_id ?? null;
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
                sourceFile: undefined,
                msgtype: item.msgtype,
                isPdf: item.isPdf,
                mxcUrl: item.mxcUrl,
                progress: item.progress,
                status: item.status,
                error: item.status === "failed" ? item.error || t("chat.uploadInterruptedNeedsReselect") : undefined,
            }));
        });
        setPendingAttachmentsByRoom(restored);
    }, [t, userId]);

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
                    msgtype: item.msgtype,
                    isPdf: item.isPdf,
                    mxcUrl: isReady ? (item.mxcUrl as string) : null,
                    status: (isReady ? "ready" : "failed") as "ready" | "failed",
                    progress: item.progress,
                    error: isReady ? undefined : item.error || t("chat.uploadInterruptedNeedsReselect"),
                    };
                    persistedItems.push(nextItem);
                });
            if (persistedItems.length > 0) persisted[roomId] = persistedItems;
        });
        writePersistedPendingAttachments(userId, persisted);
    }, [pendingAttachmentsByRoom, t, userId]);

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

    useEffect(() => {
        if (!networkOnline) return;
        if (retryUploadQueue.length === 0) return;
        const timer = window.setTimeout(() => {
            const key = retryUploadQueue[0];
            const parsed = parseUploadRetryKey(key);
            if (!parsed) {
                setRetryUploadQueue((prev) => prev.slice(1));
                return;
            }
            const target = pendingAttachmentsByRoom[parsed.roomId]?.find((item) => item.id === parsed.attachmentId);
            if (!target || target.status !== "failed" || !target.sourceFile) {
                setRetryUploadQueue((prev) => prev.filter((item) => item !== key));
                return;
            }
            setPendingAttachmentsByRoom((prev) =>
                withUpdatedRoomAttachments(prev, parsed.roomId, (items) =>
                    items.map((item) =>
                        item.id === parsed.attachmentId ? { ...item, status: "uploading", progress: 0, error: undefined } : item,
                    ),
                ),
            );
            void uploadDraftAttachmentById(parsed.roomId, parsed.attachmentId, target.sourceFile, true).then((ok) => {
                if (ok) {
                    delete retryAttemptsRef.current[key];
                    setRetryUploadQueue((prev) => prev.filter((item) => item !== key));
                    return;
                }
                const attempts = (retryAttemptsRef.current[key] ?? 0) + 1;
                retryAttemptsRef.current[key] = attempts;
                if (attempts >= UPLOAD_RETRY_MAX_ATTEMPTS) {
                    setRetryUploadQueue((prev) => prev.filter((item) => item !== key));
                    return;
                }
                setPendingAttachmentsByRoom((prev) =>
                    withUpdatedRoomAttachments(prev, parsed.roomId, (items) =>
                        items.map((item) =>
                            item.id === parsed.attachmentId
                                ? { ...item, status: "failed", error: t("chat.uploadRetryQueued") }
                                : item,
                        ),
                    ),
                );
                setRetryUploadQueue((prev) => {
                    const rest = prev.filter((item) => item !== key);
                    return [...rest, key];
                });
            });
        }, UPLOAD_RETRY_INTERVAL_MS);
        return () => window.clearTimeout(timer);
    }, [networkOnline, pendingAttachmentsByRoom, retryUploadQueue, t]);

    useEffect(() => {
        if (!matrixCredentials?.hs_url || !matrixCredentials.access_token || !userId) return;
        const now = Date.now();
        const registry = readDraftMediaRegistry();
        const expired = registry.filter(
            (item) => item.ownerUserId === userId && now - item.createdAt > DRAFT_ATTACHMENT_TTL_MS,
        );
        if (expired.length === 0) return;
        traceEvent("chat.draft_ttl_cleanup_start", { userId, count: expired.length });
        void Promise.allSettled(
            expired.map((item) =>
                cleanupUploadedMedia(matrixCredentials.hs_url!, matrixCredentials.access_token!, item.mxcUrl),
            ),
        ).finally(() => {
            removeDraftMediaEntries(expired.map((item) => item.mxcUrl));
            traceEvent("chat.draft_ttl_cleanup_done", { userId, count: expired.length });
        });
    }, [matrixCredentials?.hs_url, matrixCredentials?.access_token, userId]);
    const getLocalPart = (value: string | null | undefined): string => {
        if (!value) return "";
        const trimmed = value.startsWith("@") ? value.slice(1) : value;
        return trimmed.split(":")[0] || "";
    };
    const getUserLabel = (userId: string | null | undefined, displayName?: string | null): string => {
        const localpart = getLocalPart(userId);
        if (localpart && displayName && displayName !== localpart) {
            return `${localpart} (${displayName})`;
        }
        return localpart || displayName || userId || t("common.unknown");
    };
    const emojiStorageKey = useMemo(() => `gtt_recent_emojis:${userId ?? "guest"}`, [userId]);

    const getMatrixHost = (hsUrl: string | null): string | null => {
        if (!hsUrl) return null;
        try {
            return new URL(hsUrl).host;
        } catch {
            return null;
        }
    };

    useEffect(() => {
        if (!showActionsMenu) return;
        const handleClick = (event: MouseEvent): void => {
            const target = event.target as Node;
            if (actionsMenuRef.current?.contains(target) || actionsButtonRef.current?.contains(target)) return;
            setShowActionsMenu(false);
        };
        document.addEventListener("click", handleClick);
        return () => {
            document.removeEventListener("click", handleClick);
        };
    }, [showActionsMenu]);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(emojiStorageKey);
            if (!saved) {
                setRecentEmojis([]);
                return;
            }
            const parsed = JSON.parse(saved) as string[];
            setRecentEmojis(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, 24) : []);
        } catch {
            setRecentEmojis([]);
        }
    }, [emojiStorageKey]);

    useEffect(() => {
        if (!showEmojiBoard) return;
        const onClickOutside = (event: MouseEvent): void => {
            const target = event.target as Node;
            if (emojiBoardRef.current?.contains(target) || emojiButtonRef.current?.contains(target)) return;
            setShowEmojiBoard(false);
        };
        document.addEventListener("click", onClickOutside);
        return () => document.removeEventListener("click", onClickOutside);
    }, [showEmojiBoard]);

    const mergedEvents = useMemo(() => {
        if (!room) return [];
        const combined = [...events];
        const seen = new Set<string>();
        const filtered = combined.filter((event) => {
            const type = event.getType();
            if (type !== EventType.RoomMessage && type !== EventType.RoomMember) return false;
            if (type === EventType.RoomMessage && event.isRedacted()) return false;
            if (type === EventType.RoomMember) {
                const content = (event.getContent() ?? {}) as { membership?: string };
                const prevContent = (event.getPrevContent() ?? {}) as { membership?: string };
                if (content.membership === "join") {
                    if (prevContent.membership === "join") return false;
                } else if (content.membership === "leave") {
                    if (prevContent.membership !== "join" && prevContent.membership !== "invite") return false;
                } else {
                    return false;
                }
            }
            const key = event.getId() ?? event.getTxnId() ?? String(event.getTs());
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        filtered.sort((a, b) => a.getTs() - b.getTs());
        return filtered;
    }, [events, room]);

    const [translationMap, setTranslationMap] = useState<
        Record<string, { text: string | null; loading: boolean; error: boolean }>
    >({});
    const [translationView, setTranslationView] = useState<Record<string, boolean>>({});
    const targetLanguage = (chatReceiveLanguage || "").trim();
    const canTranslate = Boolean(translateAccessToken && targetLanguage);
    const [translationBlocked, setTranslationBlocked] = useState(false);
    const translationCacheRef = useRef<PersistedTranslationCacheRecord | null>(null);
    const translationErrorToastRef = useRef<{ key: string; ts: number } | null>(null);

    const ensureTranslationCacheLoaded = (): PersistedTranslationCacheRecord => {
        if (translationCacheRef.current) return translationCacheRef.current;
        try {
            const raw = localStorage.getItem(TRANSLATION_CACHE_STORAGE_KEY);
            if (!raw) {
                translationCacheRef.current = {};
                return translationCacheRef.current;
            }
            const parsed = JSON.parse(raw) as PersistedTranslationCacheRecord;
            if (!parsed || typeof parsed !== "object") {
                translationCacheRef.current = {};
                return translationCacheRef.current;
            }
            translationCacheRef.current = parsed;
            return parsed;
        } catch {
            translationCacheRef.current = {};
            return translationCacheRef.current;
        }
    };

    const persistTranslationCache = (record: PersistedTranslationCacheRecord): void => {
        try {
            localStorage.setItem(TRANSLATION_CACHE_STORAGE_KEY, JSON.stringify(record));
        } catch {
            // ignore persistence errors (quota/private mode)
        }
    };

    const readCachedTranslationText = (
        roomId: string,
        messageId: string,
        currentTargetLanguage: string,
        sourceText: string,
    ): string | null => {
        const record = ensureTranslationCacheLoaded();
        const key = buildTranslationCacheStorageKey(roomId, messageId, currentTargetLanguage, sourceText);
        return record[key]?.text ?? null;
    };

    const writeCachedTranslationText = (
        roomId: string,
        messageId: string,
        currentTargetLanguage: string,
        sourceText: string,
        translatedText: string,
    ): void => {
        const record = ensureTranslationCacheLoaded();
        const key = buildTranslationCacheStorageKey(roomId, messageId, currentTargetLanguage, sourceText);
        record[key] = { text: translatedText, updatedAt: Date.now() };
        const keys = Object.keys(record);
        if (keys.length > TRANSLATION_CACHE_MAX_ITEMS) {
            keys
                .sort((a, b) => (record[a]?.updatedAt ?? 0) - (record[b]?.updatedAt ?? 0))
                .slice(0, keys.length - TRANSLATION_CACHE_MAX_ITEMS)
                .forEach((expiredKey) => {
                    delete record[expiredKey];
                });
        }
        persistTranslationCache(record);
    };

    const getEventKey = (event: MatrixEvent): string =>
        event.getId() ?? event.getTxnId() ?? `${event.getTs()}-${event.getSender()}`;

    const matrixHost = getMatrixHost(matrixHsUrl);
    const resolveMatrixUserId = (contact: ContactEntry): string | null => {
        if (contact.matrix_user_id) return contact.matrix_user_id;
        if (contact.user_local_id && matrixHost) return `@${contact.user_local_id}:${matrixHost}`;
        return null;
    };
    const contactLookup = useMemo(() => {
        const map = new Map<string, ContactEntry>();
        contacts.forEach((contact) => {
            const matrixUserId = resolveMatrixUserId(contact);
            if (matrixUserId) map.set(matrixUserId, contact);
        });
        return map;
    }, [contacts, matrixHost]);
    const resolveContactByMatrixUserId = (matrixUserId?: string | null): ContactEntry | null => {
        if (!matrixUserId) return null;
        return contactLookup.get(matrixUserId) ?? null;
    };

    const roomKind = useMemo(() => {
        if (!room) return null;
        const kindEvent = room.currentState.getStateEvents(ROOM_KIND_EVENT, "");
        return (kindEvent?.getContent() as { kind?: string } | undefined)?.kind ?? null;
    }, [room]);
    const isDirectByAccountData = useMemo(() => {
        if (!matrixClient || !activeRoomId) return false;
        const event = matrixClient.getAccountData("m.direct" as never);
        const content = event?.getContent() as Record<string, unknown> | undefined;
        if (!content || typeof content !== "object") return false;
        return Object.values(content).some((value) => {
            if (!Array.isArray(value)) return false;
            return value.some((roomId) => roomId === activeRoomId);
        });
    }, [activeRoomId, matrixClient]);
    const isDirectByMembers = useMemo(() => {
        if (!room || room.isSpaceRoom()) return false;
        const joined = room.getJoinedMembers().map((member) => member.userId);
        const invited = room.getMembersWithMembership("invite").map((member) => member.userId);
        const others = Array.from(new Set([...joined, ...invited])).filter((memberId) => memberId && memberId !== userId);
        return others.length === 1;
    }, [room, userId]);
    const isDirectRoom = useMemo(() => {
        if (!room || room.isSpaceRoom()) return false;
        if (roomKind === ROOM_KIND_DIRECT) return true;
        if (roomKind === ROOM_KIND_GROUP) return false;
        if (isDirectByAccountData) return true;
        return isDirectByMembers;
    }, [isDirectByAccountData, isDirectByMembers, room, roomKind]);
    const isGroupChat = Boolean(room) && !room?.isSpaceRoom() && !isDirectRoom && roomKind === ROOM_KIND_GROUP;
    const directPeerUserId = useMemo(() => {
        if (!room || !isDirectRoom) return null;
        const joined = room.getJoinedMembers().map((member) => member.userId);
        const invited = room.getMembersWithMembership("invite").map((member) => member.userId);
        const allMembers = Array.from(new Set([...joined, ...invited]));
        return allMembers.find((memberId) => memberId && memberId !== userId) ?? null;
    }, [isDirectRoom, room, userId]);
    const directPeerContact = useMemo(() => {
        if (!directPeerUserId) return null;
        return resolveContactByMatrixUserId(directPeerUserId);
    }, [directPeerUserId, resolveContactByMatrixUserId]);
    const directTranslationEnabled = useMemo(() => {
        if (!isDirectRoom) return false;
        if (userType === "client") {
            if (directPeerContact?.user_type === "client") return false;
            return true;
        }
        if (userType === "staff") {
            if (directPeerContact?.user_type === "staff") {
                if (
                    directPeerContact.company_name &&
                    companyName &&
                    directPeerContact.company_name === companyName
                ) {
                    return false;
                }
                return true;
            }
            return true;
        }
        return true;
    }, [companyName, directPeerContact, directPeerUserId, isDirectRoom, userId, userType]);
    const groupTranslationEnabled = useMemo(() => {
        if (!isGroupChat) return false;
        return true;
    }, [isGroupChat]);

    const shouldTranslateEvent = (event: MatrixEvent, isMeMessage: boolean): boolean => {
        if (!canTranslate || translationBlocked || isMeMessage) return false;
        if (isDirectRoom && !directTranslationEnabled) return false;
        if (isGroupChat && !groupTranslationEnabled) return false;
        const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
        if (!content?.body) return false;
        if (content.msgtype && content.msgtype !== MsgType.Text) return false;
        if (isGroupChat) {
            const senderId = event.getSender() ?? null;
            const senderContact = resolveContactByMatrixUserId(senderId);
            if (userType === "client") {
                return true;
            }
            if (userType === "staff") {
                if (senderContact?.user_type === "staff") {
                    if (
                        senderContact.company_name &&
                        companyName &&
                        senderContact.company_name === companyName
                    ) {
                        return false;
                    }
                    return true;
                }
                return true;
            }
            return true;
        }
        return true;
    };

    const translateEvent = async (event: MatrixEvent, messageText: string, forceRetry = false): Promise<void> => {
        if (!translateAccessToken) return;
        const messageId = event.getId();
        if (!messageId) return;
        const key = getEventKey(event);
        const roomId = activeRoomId ?? "";
        if (!forceRetry && roomId && targetLanguage) {
            const cachedText = readCachedTranslationText(roomId, messageId, targetLanguage, messageText);
            if (cachedText) {
                setTranslationMap((prev) => ({ ...prev, [key]: { text: cachedText, loading: false, error: false } }));
                setTranslationView((prev) =>
                    prev[key] === undefined
                        ? { ...prev, [key]: translationDefaultView !== "original" }
                        : prev,
                );
                return;
            }
        }
        const senderId = event.getSender() ?? null;
        const senderContact = resolveContactByMatrixUserId(senderId);
        const senderLangHint =
            (senderContact?.translation_locale || senderContact?.locale || "").trim() || undefined;
        setTranslationMap((prev) => {
            if (prev[key]?.loading) return prev;
            if (!forceRetry && prev[key]) return prev;
            const previousText = prev[key]?.text ?? null;
            return { ...prev, [key]: { text: previousText, loading: true, error: false } };
        });
        try {
            const normalizedTargetLang = targetLanguage === "zh-TW" ? "Traditional Chinese" : targetLanguage;
            const normalizedSourceLangHint =
                senderLangHint === "zh-TW" ? "Traditional Chinese" : senderLangHint;
            const result = await hubTranslate({
                accessToken: translateAccessToken,
                text: messageText,
                targetLang: normalizedTargetLang,
                sourceLangHint: normalizedSourceLangHint,
                roomId: activeRoomId ?? undefined,
                messageId,
                sourceMatrixUserId: event.getSender() ?? undefined,
                hsUrl: translateHsUrl,
                matrixUserId: translateMatrixUserId,
            });
            if (roomId && targetLanguage) {
                writeCachedTranslationText(roomId, messageId, targetLanguage, messageText, result.translation);
            }
            setTranslationMap((prev) => ({ ...prev, [key]: { text: result.translation, loading: false, error: false } }));
            setTranslationView((prev) =>
                prev[key] === undefined
                    ? { ...prev, [key]: translationDefaultView !== "original" }
                    : prev,
            );
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : typeof error === "string"
                        ? error
                        : "";
            const toastKey = `${activeRoomId ?? "global"}:${message || "unknown"}`;
            const now = Date.now();
            const prevToast = translationErrorToastRef.current;
            if (!prevToast || prevToast.key !== toastKey || now - prevToast.ts > 15000) {
                translationErrorToastRef.current = { key: toastKey, ts: now };
                pushToast("error", message || t("chat.translationUnavailable"));
            }
            if (
                message.includes("NOT_SUBSCRIBED") ||
                message.includes("QUOTA_EXCEEDED") ||
                message.includes("CLIENT_TRANSLATION_DISABLED")
            ) {
                setTranslationBlocked(true);
            }
            setTranslationMap((prev) => ({ ...prev, [key]: { text: null, loading: false, error: true } }));
        }
    };

    const canSendReceipt = (event: MatrixEvent | undefined): event is MatrixEvent => {
        const eventId = event?.getId();
        return Boolean(eventId && eventId.startsWith("$"));
    };

    const isDeprecatedRoom = Boolean(isDirectRoom && room?.name?.startsWith(DEPRECATED_DM_PREFIX));
    const groupMembers = room?.getJoinedMembers() ?? [];
    const invitedMembers = room?.getMembersWithMembership("invite") ?? [];
    const memberCount = groupMembers.length;
    const invitedCount = invitedMembers.length;
    const powerLevels = useMemo((): PowerLevelContent | null => {
        if (!room) return null;
        const event = room.currentState.getStateEvents("m.room.power_levels", "");
        return (event?.getContent() ?? null) as PowerLevelContent | null;
    }, [room]);
    const roomVersion = useMemo(() => {
        if (!room) return null;
        const event = room.currentState.getStateEvents("m.room.create", "");
        const content = event?.getContent() as { room_version?: string } | undefined;
        return content?.room_version ?? null;
    }, [room]);
    const userPowerLevel = useMemo(() => {
        const defaultLevel = powerLevels?.users_default ?? 0;
        if (!userId) return defaultLevel;
        return powerLevels?.users?.[userId] ?? defaultLevel;
    }, [powerLevels, userId]);
    const inviteLevel = powerLevels?.invite ?? 0;
    const canManageInvites = userPowerLevel >= 100;
    const canInviteMembers = userPowerLevel >= inviteLevel;
    const canRenameGroup = userPowerLevel >= 50;
    const canRemoveMembers = userPowerLevel >= 50;
    const memberIdSet = useMemo(() => new Set(groupMembers.map((member) => member.userId)), [groupMembers]);
    const filteredContacts = useMemo(() => {
        const needle = contactFilter.trim().toLowerCase();
        return contacts.filter((contact) => {
            const matrixUserId =
                contact.matrix_user_id ||
                (contact.user_local_id && matrixHost ? `@${contact.user_local_id}:${matrixHost}` : null);
            if (!matrixUserId) return false;
            if (memberIdSet.has(matrixUserId)) return false;
            const label = getUserLabel(
                matrixUserId,
                contact.display_name || contact.user_local_id || contact.company_name,
            ).toLowerCase();
            return needle ? label.includes(needle) : true;
        });
    }, [contacts, contactFilter, matrixHost, memberIdSet]);
    const visibleInviteContacts = filteredContacts
        .map((contact) => {
            const matrixUserId =
                contact.matrix_user_id ||
                (contact.user_local_id && matrixHost ? `@${contact.user_local_id}:${matrixHost}` : null);
            if (!matrixUserId) return null;
            return {
                id: contact.user_id,
                matrixUserId,
                label: getUserLabel(matrixUserId, contact.display_name || contact.user_local_id),
            };
        })
        .filter((value): value is { id: string; matrixUserId: string; label: string } => Boolean(value));

    useEffect(() => {
        setInviteAllowed(inviteLevel === 0);
    }, [inviteLevel, room?.roomId]);

    useEffect(() => {
        if (!showInviteMembersModal || !isGroupChat) return;
        if (!inviteAccessToken) {
            setContactsError(t("chat.inviteContactsAuthMissing"));
            setContacts([]);
            return;
        }
        setContactsLoading(true);
        setContactsError(null);
        setSelectedInviteIds(new Set());
        void listContacts(inviteAccessToken, inviteHsUrl)
            .then((items) => {
                setContacts(items);
            })
            .catch((err) => {
                const message = mapActionErrorToMessage(t, err, "chat.inviteContactsFailed");
                setContactsError(message);
                pushToast("error", message);
            })
            .finally(() => setContactsLoading(false));
    }, [showInviteMembersModal, isGroupChat, inviteAccessToken, inviteHsUrl, pushToast, t]);

    useEffect(() => {
        if (!canTranslate || translationContactsLoaded) return;
        if (!inviteAccessToken) return;
        let alive = true;
        if (contacts.length) {
            setTranslationContactsLoaded(true);
            return;
        }
        setContactsLoading(true);
        setContactsError(null);
        void listContacts(inviteAccessToken, inviteHsUrl)
            .then((items) => {
                if (!alive) return;
                setContacts(items);
                setTranslationContactsLoaded(true);
            })
            .catch(() => {
                if (!alive) return;
                setTranslationContactsLoaded(true);
            })
            .finally(() => setContactsLoading(false));
        return () => {
            alive = false;
        };
    }, [canTranslate, inviteAccessToken, inviteHsUrl, translationContactsLoaded, contacts.length]);

    useEffect(() => {
        if (!canTranslate || (!isDirectRoom && !isGroupChat)) return;
        mergedEvents.forEach((event) => {
            const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
            const messageText = content?.body ?? "";
            const isMeMessage = event.getSender() === userId;
            if (!shouldTranslateEvent(event, isMeMessage)) return;
            const key = getEventKey(event);
            if (translationMap[key]) return;
            void translateEvent(event, messageText);
        });
    }, [
        canTranslate,
        directTranslationEnabled,
        isDirectRoom,
        isGroupChat,
        mergedEvents,
        targetLanguage,
        translationMap,
        groupTranslationEnabled,
        userId,
    ]);

    useEffect(() => {
        setTranslationMap({});
        setTranslationView({});
        setTranslationBlocked(false);
    }, [targetLanguage, activeRoomId]);

    useEffect(() => {
        if (!jumpToEventId) return;
        const container = timelineRef.current;
        if (!container) return;
        const escapedEventId = jumpToEventId.replace(/'/g, "\\'");
        const target = container.querySelector(`[data-event-id='${escapedEventId}']`) as HTMLElement | null;
        if (!target) return;
        if (activeRoomId) {
            roomStickBottomRef.current[activeRoomId] = false;
        }
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedEventId(jumpToEventId);
        onJumpHandled?.();
        const timer = window.setTimeout(() => {
            setHighlightedEventId((prev) => (prev === jumpToEventId ? null : prev));
        }, 1800);
        return () => window.clearTimeout(timer);
    }, [activeRoomId, jumpToEventId, mergedEvents.length, onJumpHandled]);

    useEffect(() => {
        const prevRoomId = previousRoomIdRef.current;
        const container = timelineRef.current;
        if (prevRoomId && container) {
            const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
            roomStickBottomRef.current[prevRoomId] = distance < 120;
        }
        previousRoomIdRef.current = activeRoomId;
        if (!activeRoomId || jumpToEventId) return;
        const shouldStickBottom = roomStickBottomRef.current[activeRoomId] ?? true;
        if (!shouldStickBottom) return;
        const timer = window.setTimeout(() => {
            const current = timelineRef.current;
            if (!current) return;
            current.scrollTop = current.scrollHeight;
            setShowScrollToBottom(false);
        }, 40);
        return () => window.clearTimeout(timer);
    }, [activeRoomId, jumpToEventId]);

    // 自動滾動到底部並發送已讀回執
    useEffect(() => {
        if (!room || !matrixClient) return;
        const container = timelineRef.current;
        if (!container) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        const shouldStickBottom = activeRoomId ? (roomStickBottomRef.current[activeRoomId] ?? true) : false;
        if (shouldStickBottom || distanceFromBottom < 120) {
            if (activeRoomId) roomStickBottomRef.current[activeRoomId] = true;
            container.scrollTop = container.scrollHeight;
            // 在底部時發送已讀回執
            const latestEvent = mergedEvents[mergedEvents.length - 1];
            if (canSendReceipt(latestEvent)) {
                void matrixClient.sendReadReceipt(latestEvent);
            }
        }
    }, [activeRoomId, mergedEvents.length, room, matrixClient, mergedEvents]);

    // 進入房間時如果在底部也發送已讀回執
    useEffect(() => {
        if (!matrixClient || !room || !activeRoomId) return;
        // 延遲執行以確保滾動位置已更新
        const timer = setTimeout(() => {
            const container = timelineRef.current;
            if (!container) return;
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            if (distanceFromBottom < 120) {
                const latestEvent = mergedEvents[mergedEvents.length - 1];
                if (canSendReceipt(latestEvent)) {
                    void matrixClient.sendReadReceipt(latestEvent);
                }
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [activeRoomId]); // 只在切換房間時觸發

    const onScroll = async (): Promise<void> => {
        if (!matrixClient || scrollLoading || !room) return;
        const container = timelineRef.current;
        if (!container) return;

        // 更新滾動到底部按鈕的顯示狀態
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (activeRoomId) {
            roomStickBottomRef.current[activeRoomId] = distanceFromBottom < 120;
        }
        setShowScrollToBottom(distanceFromBottom > 200);

        // 當滾動到底部時發送已讀回執
        if (distanceFromBottom < 50) {
            const latestEvent = mergedEvents[mergedEvents.length - 1];
            if (canSendReceipt(latestEvent)) {
                void matrixClient.sendReadReceipt(latestEvent);
            }
        }

        // 滾動加載更多消息
        if (container.scrollTop > 0) return;
        setScrollLoading(true);
        try {
            await matrixClient.scrollback(room, 30);
        } finally {
            setScrollLoading(false);
        }
    };

    const scrollToBottom = (): void => {
        const container = timelineRef.current;
        if (container) {
            if (activeRoomId) roomStickBottomRef.current[activeRoomId] = true;
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        }
    };

    const onSend = async (): Promise<void> => {
        if (!matrixClient || !activeRoomId || isDeprecatedRoom) return;
        const trimmed = composerText.trim();
        const readyAttachments = pendingAttachments.filter((item) => item.status === "ready" && item.mxcUrl);
        traceEvent("chat.send_start", {
            roomId: activeRoomId,
            textLength: trimmed.length,
            readyAttachments: readyAttachments.length,
            userId,
        });
        if (hasPendingUpload) {
            const message = t("chat.uploadStillInProgress");
            setUploadError(message);
            pushToast("warn", message);
            return;
        }
        if (!trimmed && readyAttachments.length === 0) return;
        if (activeRoomId) roomStickBottomRef.current[activeRoomId] = true;
        setComposerText("");
        setUploadError(null);
        let sentEventId: string | undefined;
        if (trimmed) {
            const sendResult = (await matrixClient.sendEvent(activeRoomId, EventType.RoomMessage, {
                msgtype: MsgType.Text,
                body: trimmed,
            })) as { event_id?: string } | undefined;
            sentEventId = sendResult?.event_id;
        }
        const peerLang = (directPeerContact?.translation_locale || directPeerContact?.locale || "").trim();
        const shouldPretranslateForClient =
            userType === "staff" &&
            isDirectRoom &&
            directPeerContact?.user_type === "client" &&
            Boolean(translateAccessToken && peerLang && sentEventId);

        if (shouldPretranslateForClient && sentEventId) {
            const normalizedTargetLang = peerLang === "zh-TW" ? "Traditional Chinese" : peerLang;
            const normalizedSourceLangHint =
                (chatReceiveLanguage || "").trim() === "zh-TW" ? "Traditional Chinese" : (chatReceiveLanguage || "").trim() || undefined;
            void hubTranslate({
                accessToken: translateAccessToken as string,
                text: trimmed,
                targetLang: normalizedTargetLang,
                sourceLangHint: normalizedSourceLangHint,
                roomId: activeRoomId,
                messageId: sentEventId,
                sourceMatrixUserId: userId ?? undefined,
                hsUrl: translateHsUrl,
                matrixUserId: translateMatrixUserId,
            }).catch(() => undefined);
        }
        const shouldPretranslateForGroupClients =
            userType === "staff" &&
            isGroupChat &&
            translationContactsLoaded &&
            Boolean(translateAccessToken && sentEventId);
        if (shouldPretranslateForGroupClients && sentEventId) {
            const targetLangs = new Set<string>();
            groupMembers
                .map((member) => member.userId)
                .filter((memberId) => memberId && memberId !== userId)
                .forEach((memberId) => {
                    const contact = resolveContactByMatrixUserId(memberId);
                    if (!contact || contact.user_type !== "client") return;
                    const lang = (contact.translation_locale || contact.locale || "").trim();
                    if (lang) targetLangs.add(lang);
                });
            targetLangs.forEach((lang) => {
                const normalizedTargetLang = lang === "zh-TW" ? "Traditional Chinese" : lang;
                const normalizedSourceLangHint =
                    (chatReceiveLanguage || "").trim() === "zh-TW" ? "Traditional Chinese" : (chatReceiveLanguage || "").trim() || undefined;
                void hubTranslate({
                    accessToken: translateAccessToken as string,
                    text: trimmed,
                    targetLang: normalizedTargetLang,
                    sourceLangHint: normalizedSourceLangHint,
                    roomId: activeRoomId,
                    messageId: sentEventId,
                    sourceMatrixUserId: userId ?? undefined,
                    hsUrl: translateHsUrl,
                    matrixUserId: translateMatrixUserId,
                }).catch(() => undefined);
            });
        }
        for (const attachment of readyAttachments) {
            const info: { mimetype?: string; size: number } = {
                size: attachment.fileSize,
            };
            if (attachment.mimeType) info.mimetype = attachment.mimeType;
            if (attachment.isPdf && !info.mimetype) info.mimetype = "application/pdf";
            const content: Record<string, unknown> = {
                body: attachment.fileName,
                msgtype: attachment.msgtype,
                url: attachment.mxcUrl,
                info,
            };
            await matrixClient.sendEvent(activeRoomId, EventType.RoomMessage, content as never);
        }
        if (readyAttachments.length > 0 && activeRoomId) {
            const roomId = activeRoomId;
            setPendingAttachmentsByRoom((prev) =>
                withUpdatedRoomAttachments(prev, roomId, (items) => items.filter((item) => item.status !== "ready")),
            );
            removeDraftMediaEntries(readyAttachments.map((item) => item.mxcUrl!).filter(Boolean));
        }
        traceEvent("chat.send_success", {
            roomId: activeRoomId,
            sentAttachments: readyAttachments.length,
            userId,
        });
    };

    const onResend = async (event: MatrixEvent): Promise<void> => {
        if (!matrixClient || !room) return;
        await matrixClient.resendEvent(event, room);
    };

    const isFileEvent = (event: MatrixEvent): boolean => {
        const content = event.getContent() as { msgtype?: string } | undefined;
        const msgtype = content?.msgtype;
        return (
            msgtype === MsgType.File ||
            msgtype === MsgType.Image ||
            msgtype === MsgType.Video ||
            msgtype === MsgType.Audio
        );
    };

    const isOwnFileEvent = (event: MatrixEvent): boolean => {
        if (!userId || !isFileEvent(event)) return false;
        return event.getSender() === userId;
    };

    const canDeleteFileEvent = (event: MatrixEvent): boolean => {
        if (!isOwnFileEvent(event)) return false;
        if (!event.getId()) return false;
        return true;
    };

    const onDeleteFileEvent = async (event: MatrixEvent): Promise<void> => {
        const eventId = event.getId();
        if (!matrixClient || !activeRoomId || !eventId || !userId) return;
        if (!canDeleteFileEvent(event)) {
            setUploadError(t("chat.deleteFileExpired"));
            return;
        }
        traceEvent("chat.file_delete_start", { roomId: activeRoomId, eventId, userId });
        setDeletingEventId(eventId);
        try {
            await matrixClient.redactEvent(activeRoomId, eventId);
            const content = event.getContent() as { url?: string } | undefined;
            if (content?.url && matrixCredentials?.hs_url && matrixCredentials?.access_token) {
                await cleanupUploadedMedia(matrixCredentials.hs_url, matrixCredentials.access_token, content.url);
                removeDraftMediaEntries([content.url]);
            }
            const selfLabel = getLocalPart(userId) || userId;
            await matrixClient.sendEvent(activeRoomId, EventType.RoomMessage, {
                msgtype: MsgType.Notice,
                body: t("chat.fileRevokedNotice", { name: selfLabel }),
            } as never);
            traceEvent("chat.file_delete_success", { roomId: activeRoomId, eventId, userId });
        } catch (error) {
            const mapped = mapMediaActionError(error);
            const message = mapActionErrorToMessage(t, error, "chat.deleteFileFailed");
            setUploadError(message || t("chat.deleteFileFailed"));
            pushToast("error", message || t("chat.deleteFileFailed"));
            traceEvent("chat.file_delete_failed", { roomId: activeRoomId, eventId, userId, reason: mapped });
        } finally {
            setDeletingEventId(null);
        }
    };

    const otherMember = room
        ? room.getJoinedMembers().find((member) => member.userId !== userId)
        : undefined;
    const headerName = getUserLabel(otherMember?.userId, otherMember?.name) || room?.name || t("chat.headerFallback");
    const groupName = room?.name || t("chat.groupNameFallback");
    const memberEntries = useMemo(() => {
        const defaultLevel = powerLevels?.users_default ?? 0;
        return groupMembers
            .map((member) => ({
                userId: member.userId,
                name: member.name || member.userId,
                powerLevel: powerLevels?.users?.[member.userId] ?? defaultLevel,
            }))
            .sort((a, b) => {
                if (a.powerLevel !== b.powerLevel) return b.powerLevel - a.powerLevel;
                return a.name.localeCompare(b.name);
            });
    }, [groupMembers, powerLevels]);
    const invitedEntries = useMemo(() => {
        const defaultLevel = powerLevels?.users_default ?? 0;
        return invitedMembers
            .map((member) => ({
                userId: member.userId,
                name: member.name || member.userId,
                powerLevel: powerLevels?.users?.[member.userId] ?? defaultLevel,
            }))
            .sort((a, b) => {
                if (a.powerLevel !== b.powerLevel) return b.powerLevel - a.powerLevel;
                return a.name.localeCompare(b.name);
            });
    }, [invitedMembers, powerLevels]);
    const openMediaPreview = (payload: { url: string; type: "image" | "video" | "pdf" }): void => {
        setMediaPreview(payload);
        setMediaZoom(1);
        setMediaOffset({ x: 0, y: 0 });
    };

    const onPickAttachment = (): void => {
        if (isDeprecatedRoom) return;
        setUploadError(null);
        fileInputRef.current?.click();
    };

    const uploadDraftAttachmentById = async (
        roomId: string,
        attachmentId: string,
        file: File,
        silentAutoRetry = false,
    ): Promise<boolean> => {
        if (!matrixClient) return false;
        const normalizeMime = (value: string | undefined): string => (value ?? "").toLowerCase();
        const mimeType = normalizeMime(file.type);
        traceEvent("chat.upload_start", {
            roomId,
            fileName: file.name,
            fileSize: file.size,
            mimeType,
            userId,
            attachmentId,
        });
        try {
            const uploadResult = (await matrixClient.uploadContent(file, {
                includeFilename: false,
                progressHandler: (progress) => {
                    const uploaded = progress.loaded ?? 0;
                    const total = progress.total ?? 0;
                    if (!total) return;
                    const percent = Math.min(100, Math.max(0, Math.round((uploaded / total) * 100)));
                    setPendingAttachmentsByRoom((prev) =>
                        withUpdatedRoomAttachments(prev, roomId, (items) =>
                            items.map((item) =>
                                item.id === attachmentId ? { ...item, progress: percent, status: "uploading" } : item,
                            ),
                        ),
                    );
                },
            })) as { content_uri?: string } | string;

            const mxcUrl = typeof uploadResult === "string" ? uploadResult : uploadResult.content_uri;
            if (!mxcUrl) throw new Error("upload content_uri missing");
            if (userId) {
                upsertDraftMediaEntry({ mxcUrl, createdAt: Date.now(), ownerUserId: userId });
            }
            setPendingAttachmentsByRoom((prev) =>
                withUpdatedRoomAttachments(prev, roomId, (items) =>
                    items.map((item) =>
                        item.id === attachmentId ? { ...item, mxcUrl, progress: 100, status: "ready", error: undefined } : item,
                    ),
                ),
            );
            traceEvent("chat.upload_success", { roomId, fileName: file.name, mxcUrl, userId, attachmentId });
            return true;
        } catch (error) {
            const mapped = mapMediaActionError(error);
            const message = mapActionErrorToMessage(t, error, "chat.uploadFailed");
            const offlineNow = typeof navigator !== "undefined" ? navigator.onLine === false : false;
            const shouldQueueRetry = (offlineNow || isTransientUploadError(error)) && file.size > 0;
            const finalError = shouldQueueRetry ? t("chat.uploadRetryQueued") : message || t("chat.uploadFailed");
            setPendingAttachmentsByRoom((prev) =>
                withUpdatedRoomAttachments(prev, roomId, (items) =>
                    items.map((item) =>
                        item.id === attachmentId ? { ...item, status: "failed", error: finalError } : item,
                    ),
                ),
            );
            if (shouldQueueRetry) {
                const key = buildUploadRetryKey(roomId, attachmentId);
                if (!silentAutoRetry) {
                    pushToast("warn", finalError);
                }
                setRetryUploadQueue((prev) => (prev.includes(key) ? prev : [...prev, key]));
            } else if (!silentAutoRetry) {
                pushToast("error", message || t("chat.uploadFailed"));
            }
            traceEvent("chat.upload_failed", { roomId, fileName: file.name, userId, reason: mapped, attachmentId });
            return false;
        }
    };

    const uploadDraftAttachment = async (file: File): Promise<void> => {
        if (!matrixClient || !activeRoomId || isDeprecatedRoom) return;
        const roomId = activeRoomId;
        const attachmentId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const normalizeMime = (value: string | undefined): string => (value ?? "").toLowerCase();
        const mimeType = normalizeMime(file.type);
        const isImageFile = mimeType.startsWith("image/");
        const isVideoFile = mimeType.startsWith("video/");
        const isAudioFile = mimeType.startsWith("audio/");
        const isPdfFile = mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const msgtype = isImageFile
            ? MsgType.Image
            : isVideoFile
                ? MsgType.Video
                : isAudioFile
                    ? MsgType.Audio
                    : MsgType.File;
        setPendingAttachmentsByRoom((prev) =>
            withUpdatedRoomAttachments(prev, roomId, (items) => [
                ...items,
                {
                    id: attachmentId,
                    fileName: file.name,
                    fileSize: file.size,
                    mimeType,
                    sourceFile: file,
                    msgtype,
                    isPdf: isPdfFile,
                    mxcUrl: null,
                    progress: 0,
                    status: "uploading",
                },
            ]),
        );
        setUploadError(null);
        await uploadDraftAttachmentById(roomId, attachmentId, file);
    };

    const onRetryPendingAttachment = async (attachmentId: string): Promise<void> => {
        if (!activeRoomId) return;
        const roomId = activeRoomId;
        const target = pendingAttachments.find((item) => item.id === attachmentId);
        if (!target || target.status !== "failed" || !target.sourceFile) return;
        setPendingAttachmentsByRoom((prev) =>
            withUpdatedRoomAttachments(prev, roomId, (items) =>
                items.map((item) =>
                    item.id === attachmentId ? { ...item, status: "uploading", progress: 0, error: undefined } : item,
                ),
            ),
        );
        setUploadError(null);
        traceEvent("chat.upload_retry", { roomId, attachmentId, fileName: target.fileName, userId });
        const key = buildUploadRetryKey(roomId, attachmentId);
        delete retryAttemptsRef.current[key];
        setRetryUploadQueue((prev) => prev.filter((item) => item !== key));
        await uploadDraftAttachmentById(roomId, attachmentId, target.sourceFile);
    };

    const onReattachPendingAttachment = (attachmentId: string): void => {
        if (!activeRoomId) return;
        setRetryPickTarget({ roomId: activeRoomId, attachmentId });
        retryFileInputRef.current?.click();
    };

    const onRemovePendingAttachment = async (attachmentId: string): Promise<void> => {
        if (!activeRoomId) return;
        const roomId = activeRoomId;
        const target = pendingAttachments.find((item) => item.id === attachmentId);
        if (!target || target.status === "uploading") return;
        traceEvent("chat.upload_cancel", { roomId, attachmentId, fileName: target.fileName, userId });
        const key = buildUploadRetryKey(roomId, attachmentId);
        delete retryAttemptsRef.current[key];
        setRetryUploadQueue((prev) => prev.filter((item) => item !== key));
        setPendingAttachmentsByRoom((prev) =>
            withUpdatedRoomAttachments(prev, roomId, (items) =>
                items.map((item) => (item.id === attachmentId ? { ...item, status: "removing" } : item)),
            ),
        );
        if (target.mxcUrl && matrixCredentials?.hs_url && matrixCredentials?.access_token) {
            await cleanupUploadedMedia(matrixCredentials.hs_url, matrixCredentials.access_token, target.mxcUrl);
            removeDraftMediaEntries([target.mxcUrl]);
        }
        setPendingAttachmentsByRoom((prev) =>
            withUpdatedRoomAttachments(prev, roomId, (items) => items.filter((item) => item.id !== attachmentId)),
        );
    };

    const addRecentEmoji = (emoji: string): void => {
        setRecentEmojis((prev) => {
            const next = [emoji, ...prev.filter((value) => value !== emoji)].slice(0, 24);
            localStorage.setItem(emojiStorageKey, JSON.stringify(next));
            return next;
        });
    };

    const insertEmojiToComposer = (emoji: string): void => {
        addRecentEmoji(emoji);
        const input = composerRef.current;
        if (!input) {
            setComposerText((prev) => `${prev}${emoji}`);
            return;
        }
        const start = input.selectionStart ?? composerText.length;
        const end = input.selectionEnd ?? start;
        const nextText = `${composerText.slice(0, start)}${emoji}${composerText.slice(end)}`;
        setComposerText(nextText);
        requestAnimationFrame(() => {
            const cursor = start + emoji.length;
            input.focus();
            input.setSelectionRange(cursor, cursor);
        });
    };

    const adjustComposerHeight = (): void => {
        const input = composerRef.current;
        if (!input) return;
        const styles = window.getComputedStyle(input);
        const lineHeight = Number.parseFloat(styles.lineHeight || "20") || 20;
        const paddingTop = Number.parseFloat(styles.paddingTop || "0") || 0;
        const paddingBottom = Number.parseFloat(styles.paddingBottom || "0") || 0;
        const borderTop = Number.parseFloat(styles.borderTopWidth || "0") || 0;
        const borderBottom = Number.parseFloat(styles.borderBottomWidth || "0") || 0;
        const maxHeight = (lineHeight * 5) + paddingTop + paddingBottom + borderTop + borderBottom;
        input.style.height = "auto";
        const nextHeight = Math.min(input.scrollHeight, maxHeight);
        input.style.height = `${nextHeight}px`;
        input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
    };

    useEffect(() => {
        adjustComposerHeight();
    }, [composerText, activeRoomId]);

    const visibleEmojis = useMemo(() => {
        const merged = [...recentEmojis, ...EMOJI_LIST];
        return Array.from(new Set(merged));
    }, [recentEmojis]);

    if (!activeRoomId) {
        return <div className="flex-1" />;
    }

    if (!room) {
        return (
            <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                {t("chat.loading")}
            </div>
        );
    }
    if (room.getMyMembership() !== "join") {
        return (
            <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                {t("chat.notInRoomPlaceholder", "This room is no longer available")}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full min-h-0">
            {/* 4. Header */}
            <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6 flex-shrink-0 shadow-sm z-10 dark:bg-slate-900 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    {onMobileBack && (
                        <button
                            type="button"
                            onClick={onMobileBack}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                            aria-label={t("layout.backToList")}
                        >
                            <ChevronLeftIcon className="h-5 w-5" />
                        </button>
                    )}
                    {isGroupChat ? (
                        <>
                            <div className="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-700 dark:text-emerald-300 text-sm font-semibold">
                                {groupName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex flex-col">
                                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                                    {groupName}
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowMembersModal(true)}
                                className="ml-2 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-300"
                            >
                                {t("chat.membersButton")}
                                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-2 text-[10px] font-bold text-white">
                                    {memberCount}
                                </span>
                            </button>
                        </>
                    ) : (
                        <div className="flex flex-col">
                            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{headerName}</h2>
                            <span className="text-xs text-green-600 flex items-center gap-1 dark:text-emerald-400">
                                <span className="w-2 h-2 bg-green-500 rounded-full dark:bg-emerald-400"></span>
                                {t("common.online")}
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4 text-gray-500 dark:text-slate-400">
                    <button className="hover:text-[#2F5C56] transition-colors p-2 rounded-full hover:bg-gray-50 dark:hover:bg-slate-800">
                        <MagnifyingGlassIcon className="w-6 h-6" />
                    </button>
                    <div className="relative">
                        <button
                            ref={actionsButtonRef}
                            type="button"
                            onClick={() => setShowActionsMenu((prev) => !prev)}
                            className="hover:text-[#2F5C56] transition-colors p-2 rounded-full hover:bg-gray-50 dark:hover:bg-slate-800"
                            aria-label={t("chat.actionsMenu")}
                        >
                            <EllipsisVerticalIcon className="w-6 h-6" />
                        </button>
                        {showActionsMenu && (
                            <div
                                ref={actionsMenuRef}
                                className="absolute right-0 mt-2 w-40 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-slate-800 dark:bg-slate-900"
                            >
                                {isGroupChat ? (
                                    <>
                                        {canManageInvites && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowActionsMenu(false);
                                                    setShowInviteSettingsModal(true);
                                                    setInviteError(null);
                                                }}
                                                className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                            >
                                                {t("chat.inviteSettings")}
                                            </button>
                                        )}
                                        {canInviteMembers && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowActionsMenu(false);
                                                    setShowInviteMembersModal(true);
                                                    setInviteMemberError(null);
                                                }}
                                                className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                            >
                                                {t("chat.inviteMembers")}
                                            </button>
                                        )}
                                        {canRenameGroup && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowActionsMenu(false);
                                                    setRenameValue(groupName);
                                                    setShowRenameModal(true);
                                                    setRenameError(null);
                                                }}
                                                className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                            >
                                                {t("chat.renameGroup")}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowActionsMenu(false);
                                                setShowRoomInfoModal(true);
                                            }}
                                            className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                        >
                                            {t("chat.roomInfo")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowActionsMenu(false);
                                                setShowLeaveConfirm(true);
                                            }}
                                            className="w-full px-3 py-2 text-left text-rose-500 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-slate-800"
                                        >
                                            {t("chat.leaveGroup")}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowActionsMenu(false);
                                                setShowRoomInfoModal(true);
                                            }}
                                            className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                        >
                                            {t("chat.roomInfo")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowActionsMenu(false);
                                                onHideRoom?.();
                                            }}
                                            className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                        >
                                            {t("chat.hide")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowActionsMenu(false);
                                                onTogglePin?.();
                                            }}
                                            className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                        >
                                            {isRoomPinned ? t("chat.unpin") : t("chat.pin")}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Chat History (Timeline) */}
            <div
                ref={timelineRef}
                data-testid="chat-timeline"
                onScroll={() => void onScroll()}
                className="flex-1 min-h-0 overflow-y-auto p-6 bg-[#F2F4F7] dark:bg-slate-950"
            >
                {isDeprecatedRoom && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-200">
                        {t("chat.deprecatedNotice")}
                    </div>
                )}
                {scrollLoading && (
                    <div className="text-center text-xs text-slate-400 dark:text-slate-500 mb-4">
                        {t("common.loading")}
                    </div>
                )}
                {mergedEvents.map((event) => {
                    if (event.getType() === EventType.RoomMember) {
                        if (!room || room.isSpaceRoom() || isDirectRoom) return null;
                        const content = (event.getContent() ?? {}) as { membership?: string };
                        const prevContent = (event.getPrevContent() ?? {}) as { membership?: string; displayname?: string };
                        if (content.membership !== "join" && content.membership !== "leave") return null;
                        if (content.membership === "leave" && prevContent.membership !== "join" && prevContent.membership !== "invite") {
                            return null;
                        }
                        if (content.membership === "join" && prevContent.membership === "join") return null;
                        const targetUserId = event.getStateKey() ?? "";
                        if (!targetUserId) return null;
                        const targetMember = room.getMember(targetUserId);
                        const targetLabel = getUserLabel(targetUserId, targetMember?.name ?? prevContent.displayname);
                        const actorUserId = event.getSender();
                        const noticeText =
                            content.membership === "join"
                                ? t("chat.memberJoinedNotice", {
                                    name: targetLabel,
                                    defaultValue: `${targetLabel} joined the room`,
                                })
                                : actorUserId === targetUserId
                                    ? t("chat.memberLeftNotice", {
                                        name: targetLabel,
                                        defaultValue: `${targetLabel} left the room`,
                                    })
                                    : t("chat.memberKickedNotice", {
                                        name: targetLabel,
                                        defaultValue: `${targetLabel} was removed from the room`,
                                    });
                        const noticeTime = formatNoticeTimestamp(event.getTs());
                        return (
                            <div
                                key={event.getId() ?? event.getTxnId() ?? `${event.getTs()}-${targetUserId}`}
                                className="mb-3 flex justify-center"
                            >
                                <div className="rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                    {noticeTime} {noticeText}
                                </div>
                            </div>
                        );
                    }
                    const eventContent = event.getContent() as { body?: string; msgtype?: string } | undefined;
                    if (eventContent?.msgtype === MsgType.Notice && eventContent.body) {
                        return (
                            <div
                                key={event.getId() ?? event.getTxnId() ?? `${event.getTs()}-notice`}
                                className="mb-3 flex justify-center"
                            >
                                <div className="rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                    {formatNoticeTimestamp(event.getTs())} {eventContent.body}
                                </div>
                            </div>
                        );
                    }
                    const status = event.getAssociatedStatus?.() ?? event.status ?? null;
                    const isMe = event.getSender() === userId;
                    const content = event.getContent() as { url?: string; msgtype?: string } | undefined;
                    const mediaUrl =
                        content?.url && matrixClient
                            ? content.msgtype === MsgType.Image
                                ? matrixClient.mxcUrlToHttp(content.url, 800, 800, "scale")
                                : matrixClient.mxcUrlToHttp(content.url)
                            : null;
                    const sender = event.getSender();
                    const senderMember = sender ? room?.getMember(sender) : null;
                    const senderLabel = getUserLabel(sender, senderMember?.name);
                    const eventId = event.getId() ?? "";
                    return (
                        <div
                            key={event.getId() ?? event.getTxnId() ?? `${event.getTs()}-${event.getSender()}`}
                            data-event-id={eventId || undefined}
                            data-testid={eventId ? `chat-event-${eventId}` : undefined}
                            className={highlightedEventId === eventId ? "rounded-xl ring-2 ring-emerald-400/70" : ""}
                        >
                            <MessageBubble
                                event={event}
                                isMe={isMe}
                                status={status}
                                mediaUrl={mediaUrl}
                                onResend={onResend}
                                senderLabel={senderLabel}
                                onOpenMedia={openMediaPreview}
                                translatedText={translationMap[getEventKey(event)]?.text ?? null}
                                translationLoading={translationMap[getEventKey(event)]?.loading ?? false}
                                translationError={translationMap[getEventKey(event)]?.error ?? false}
                                showTranslation={translationView[getEventKey(event)] ?? (!isMe && translationDefaultView !== "original")}
                                canDeleteFile={isOwnFileEvent(event)}
                                deleteBusy={deletingEventId === event.getId()}
                                onDeleteFile={(targetEvent) => {
                                    void onDeleteFileEvent(targetEvent);
                                }}
                                onToggleTranslation={() => {
                                    const key = getEventKey(event);
                                    const nextValue = !(translationView[key] ?? false);
                                    setTranslationView((prev) => ({ ...prev, [key]: nextValue }));
                                    if (nextValue) {
                                        const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
                                        const messageText = content?.body ?? "";
                                        const cache = translationMap[key];
                                        const hasCachedTranslation = Boolean((cache?.text ?? "").trim());
                                        const shouldRetry =
                                            !cache || (!cache.loading && !hasCachedTranslation && Boolean(cache.error));
                                        if (messageText && shouldRetry) {
                                            void translateEvent(event, messageText, true);
                                        }
                                    }
                                }}
                            />
                        </div>
                    );
                })}
            </div>

            {/* 滾動到底部按鈕 */}
            {showScrollToBottom && (
                <button
                    type="button"
                    onClick={scrollToBottom}
                    className="absolute bottom-32 right-8 w-10 h-10 bg-white dark:bg-slate-800 rounded-full shadow-lg border border-gray-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors z-20"
                    aria-label={t("chat.scrollToBottom")}
                >
                    <ChevronDownIcon className="w-5 h-5" />
                </button>
            )}

            {/* Composer */}
            <div data-testid="chat-composer" className="bg-white border-t border-gray-200 p-4 flex-shrink-0 dark:bg-slate-900 dark:border-slate-800 relative">
                {/* Toolbar */}
                <div className="flex gap-4 mb-2 px-1 text-gray-400 dark:text-slate-500">
                    <button
                        ref={emojiButtonRef}
                        type="button"
                        className={`hover:text-[#2F5C56] dark:hover:text-emerald-400 ${showEmojiBoard ? "text-[#2F5C56] dark:text-emerald-400" : ""}`}
                        onClick={() => setShowEmojiBoard((prev) => !prev)}
                    >
                        <FaceSmileIcon className="w-6 h-6" />
                    </button>
                    <button
                        data-testid="chat-attach-button"
                        type="button"
                        onClick={onPickAttachment}
                        className="hover:text-[#2F5C56] dark:hover:text-emerald-400"
                        disabled={isDeprecatedRoom}
                    >
                        <PaperClipIcon className="w-6 h-6" />
                    </button>
                    <button type="button" className="hover:text-[#2F5C56] dark:hover:text-emerald-400">
                        <MicrophoneIcon className="w-6 h-6" />
                    </button>
                </div>

                {/* Input Area */}
                <div className="flex gap-3 items-end">
                    <input
                        ref={fileInputRef}
                        data-testid="chat-file-input"
                        type="file"
                        className="hidden"
                        multiple
                        onChange={(event) => {
                            const files = Array.from(event.target.files ?? []);
                            event.target.value = "";
                            if (!files.length) return;
                            files.forEach((file) => {
                                void uploadDraftAttachment(file);
                            });
                        }}
                    />
                    <input
                        ref={retryFileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (!file || !retryPickTarget) return;
                            const { roomId, attachmentId } = retryPickTarget;
                            setRetryPickTarget(null);
                            const normalizeMime = (value: string | undefined): string => (value ?? "").toLowerCase();
                            const mimeType = normalizeMime(file.type);
                            const isImageFile = mimeType.startsWith("image/");
                            const isVideoFile = mimeType.startsWith("video/");
                            const isAudioFile = mimeType.startsWith("audio/");
                            const isPdfFile = mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
                            const msgtype = isImageFile
                                ? MsgType.Image
                                : isVideoFile
                                    ? MsgType.Video
                                    : isAudioFile
                                        ? MsgType.Audio
                                        : MsgType.File;
                            setPendingAttachmentsByRoom((prev) =>
                                withUpdatedRoomAttachments(prev, roomId, (items) =>
                                    items.map((item) =>
                                        item.id === attachmentId
                                            ? {
                                                ...item,
                                                fileName: file.name,
                                                fileSize: file.size,
                                                mimeType,
                                                sourceFile: file,
                                                msgtype,
                                                isPdf: isPdfFile,
                                                status: "uploading",
                                                progress: 0,
                                                error: undefined,
                                            }
                                            : item,
                                    ),
                                ),
                            );
                            const key = buildUploadRetryKey(roomId, attachmentId);
                            delete retryAttemptsRef.current[key];
                            setRetryUploadQueue((prev) => prev.filter((item) => item !== key));
                            void uploadDraftAttachmentById(roomId, attachmentId, file);
                        }}
                    />
                    <textarea
                        ref={composerRef}
                        data-testid="chat-composer-input"
                        value={composerText}
                        onChange={(event) => setComposerText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                                event.preventDefault();
                                void onSend();
                            }
                        }}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-slate-800 leading-5 focus:outline-none focus:border-[#2F5C56] focus:ring-1 focus:ring-[#2F5C56] resize-none min-h-12 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:focus:border-emerald-400 dark:focus:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-slate-800"
                        placeholder={isDeprecatedRoom ? t("chat.deprecatedPlaceholder") : t("chat.placeholder")}
                        rows={1}
                        disabled={isDeprecatedRoom}
                    />
                    <button
                        data-testid="chat-send-button"
                        type="button"
                        onClick={() => void onSend()}
                        className="bg-[#2F5C56] hover:bg-[#244a45] text-white p-3 rounded-xl shadow-md transition-colors flex items-center justify-center dark:bg-emerald-500 dark:hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isDeprecatedRoom || (composerText.trim().length === 0 && pendingAttachments.filter((item) => item.status === "ready").length === 0)}
                    >
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
                {(pendingAttachments.length > 0 || uploadError) && (
                    <div className="mt-2 text-xs">
                        {pendingAttachments.map((item) => (
                            <div
                                key={item.id}
                                data-testid={`chat-pending-attachment-${item.id}`}
                                className="mb-1 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
                            >
                                <div className="min-w-0 text-slate-600 dark:text-slate-300">
                                    <div className="truncate">{item.fileName}</div>
                                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                                        {item.status === "uploading" &&
                                            t("chat.uploadingFile", {
                                                name: item.fileName,
                                                percent: item.progress,
                                            })}
                                        {item.status === "ready" && t("chat.fileReadyToSend")}
                                        {item.status === "failed" && (item.error || t("chat.uploadFailed"))}
                                        {item.status === "removing" && t("chat.removingFile")}
                                    </div>
                                </div>
                                <div className="ml-2 flex items-center gap-1">
                                    {item.status === "failed" && item.sourceFile && (
                                        <button
                                            type="button"
                                            onClick={() => void onRetryPendingAttachment(item.id)}
                                            className="rounded-md border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                                        >
                                            {t("chat.retryUpload")}
                                        </button>
                                    )}
                                    {item.status === "failed" && !item.sourceFile && (
                                        <button
                                            type="button"
                                            onClick={() => onReattachPendingAttachment(item.id)}
                                            className="rounded-md border border-sky-300 px-2 py-0.5 text-[11px] text-sky-600 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/20"
                                        >
                                            {t("chat.reselectFile")}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        data-testid={`chat-remove-pending-${item.id}`}
                                        onClick={() => void onRemovePendingAttachment(item.id)}
                                        className="rounded-full px-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                        disabled={item.status === "uploading" || item.status === "removing"}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))}
                        {uploadError && <div className="text-rose-500">{uploadError}</div>}
                    </div>
                )}
                {showEmojiBoard && (
                    <div
                        ref={emojiBoardRef}
                        className="absolute bottom-[90px] left-4 z-30 w-[320px] rounded-xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                    >
                        <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto pr-1">
                            {visibleEmojis.length > 0 ? (
                                visibleEmojis.map((emoji) => (
                                    <button
                                        key={emoji}
                                        type="button"
                                        onClick={() => insertEmojiToComposer(emoji)}
                                        className="rounded p-1 text-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                        {emoji}
                                    </button>
                                ))
                            ) : (
                                <div className="col-span-8 py-6 text-center text-xs text-slate-400">
                                    No emojis
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {showMembersModal && isGroupChat && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                                {t("chat.membersTitle")} ({memberCount})
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowMembersModal(false)}
                                className="rounded-full p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                                aria-label={t("common.close")}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto space-y-4">
                            <div>
                                <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                    {t("group.joinedMembers")} ({memberCount})
                                </div>
                                <div className="space-y-2">
                                    {memberEntries.map((member) => (
                                        <div
                                            key={member.userId}
                                            className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 dark:border-slate-800"
                                        >
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                                    {getUserLabel(member.userId, member.name)}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {member.powerLevel >= 50 && (
                                                    <span className="text-xs text-emerald-600 dark:text-emerald-400">
                                                        {t("chat.groupAdminTag")}
                                                    </span>
                                                )}
                                                {canRemoveMembers && member.userId !== userId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setMemberToRemove({
                                                                userId: member.userId,
                                                                label: getUserLabel(member.userId, member.name),
                                                                membership: "join",
                                                            });
                                                            setRemoveMemberError(null);
                                                            setShowRemoveConfirm(true);
                                                        }}
                                                        className="text-xs text-rose-500 hover:text-rose-400"
                                                    >
                                                        {t("chat.removeMember")}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                    {t("group.invitedMembers")} ({invitedCount})
                                </div>
                                {invitedEntries.length === 0 ? (
                                    <div className="text-xs text-slate-400 dark:text-slate-500">
                                        {t("common.placeholder")}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {invitedEntries.map((member) => (
                                            <div
                                                key={member.userId}
                                                className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 dark:border-slate-800"
                                            >
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                                        {getUserLabel(member.userId, member.name)}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {canRemoveMembers && member.userId !== userId && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setMemberToRemove({
                                                                    userId: member.userId,
                                                                    label: getUserLabel(member.userId, member.name),
                                                                    membership: "invite",
                                                                });
                                                                setRemoveMemberError(null);
                                                                setShowRemoveConfirm(true);
                                                            }}
                                                            className="text-xs text-rose-500 hover:text-rose-400"
                                                        >
                                                            {t("chat.removeMember")}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showInviteSettingsModal && isGroupChat && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                                {t("chat.inviteSettings")}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowInviteSettingsModal(false)}
                                className="rounded-full p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                                aria-label={t("common.close")}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3 dark:border-slate-800">
                            <div className="text-sm text-slate-700 dark:text-slate-200">
                                {t("chat.allowMembersInvite")}
                            </div>
                            <button
                                type="button"
                                disabled={inviteBusy}
                                onClick={() => {
                                    if (!room) return;
                                    const next = !inviteAllowed;
                                    setInviteBusy(true);
                                    setInviteError(null);
                                    void updateRoomInvitePermission(room.roomId, next)
                                        .then(() => setInviteAllowed(next))
                                        .catch((err) => {
                                            const message = mapActionErrorToMessage(t, err, "chat.inviteSettingsFailed");
                                            setInviteError(message);
                                            pushToast("error", message);
                                        })
                                        .finally(() => setInviteBusy(false));
                                }}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                    inviteAllowed ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
                                }`}
                            >
                                <span
                                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                                        inviteAllowed ? "translate-x-5" : "translate-x-1"
                                    }`}
                                />
                            </button>
                        </div>
                        {inviteError && <div className="mt-3 text-sm text-rose-500">{inviteError}</div>}
                    </div>
                </div>
            )}

            {showInviteMembersModal && isGroupChat && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                                {t("chat.inviteMembers")}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowInviteMembersModal(false)}
                                className="rounded-full p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                                aria-label={t("common.close")}
                            >
                                ✕
                            </button>
                        </div>
                        <input
                            type="text"
                            value={contactFilter}
                            onChange={(event) => setContactFilter(event.target.value)}
                            placeholder={t("chat.inviteSearchPlaceholder")}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        {contactsLoading && (
                            <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t("common.loading")}</div>
                        )}
                        {contactsError && <div className="mt-3 text-sm text-rose-500">{contactsError}</div>}
                        {!contactsLoading && !contactsError && visibleInviteContacts.length === 0 && (
                            <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                {t("chat.inviteContactsEmpty")}
                            </div>
                        )}
                        <div className="mt-4 max-h-64 overflow-y-auto space-y-2">
                            {visibleInviteContacts.map((contact) => (
                                <label
                                    key={contact.id}
                                    className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-100"
                                >
                                    <span className="truncate">{contact.label}</span>
                                    <input
                                        type="checkbox"
                                        checked={selectedInviteIds.has(contact.matrixUserId)}
                                        onChange={(event) => {
                                            setSelectedInviteIds((prev) => {
                                                const next = new Set(prev);
                                                if (event.target.checked) {
                                                    next.add(contact.matrixUserId);
                                                } else {
                                                    next.delete(contact.matrixUserId);
                                                }
                                                return next;
                                            });
                                        }}
                                    />
                                </label>
                            ))}
                        </div>
                        {inviteMemberError && <div className="mt-3 text-sm text-rose-500">{inviteMemberError}</div>}
                        <div className="mt-4 flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowInviteMembersModal(false)}
                                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                type="button"
                                disabled={inviteMemberBusy || selectedInviteIds.size === 0}
                                onClick={() => {
                                    setInviteMemberBusy(true);
                                    setInviteMemberError(null);
                                    const targets = Array.from(selectedInviteIds);
                                    if (!room) {
                                        setInviteMemberError(t("chat.inviteMemberFailed"));
                                        setInviteMemberBusy(false);
                                        return;
                                    }
                                    void inviteUsersToRoom(room.roomId, targets)
                                        .then(() => {
                                            setSelectedInviteIds(new Set());
                                            setShowInviteMembersModal(false);
                                        })
                                        .catch((err) => {
                                            const message = mapActionErrorToMessage(t, err, "chat.inviteMemberFailed");
                                            setInviteMemberError(message);
                                            pushToast("error", message);
                                        })
                                        .finally(() => setInviteMemberBusy(false));
                                }}
                                className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                            >
                                {inviteMemberBusy ? t("common.loading") : t("chat.inviteMemberAction")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showRenameModal && isGroupChat && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                                {t("chat.renameGroup")}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowRenameModal(false)}
                                className="rounded-full p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                                aria-label={t("common.close")}
                            >
                                ✕
                            </button>
                        </div>
                        <input
                            type="text"
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            placeholder={t("chat.renameGroupPlaceholder")}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        {renameError && <div className="mt-3 text-sm text-rose-500">{renameError}</div>}
                        <div className="mt-4 flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowRenameModal(false)}
                                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                type="button"
                                disabled={renameBusy}
                                onClick={() => {
                                    if (!matrixClient || !room) return;
                                    const nextName = renameValue.trim();
                                    if (!nextName) {
                                        setRenameError(t("chat.renameGroupRequired"));
                                        return;
                                    }
                                    setRenameBusy(true);
                                    setRenameError(null);
                                    void matrixClient
                                        .setRoomName(room.roomId, nextName)
                                        .then(() => {
                                            setShowRenameModal(false);
                                        })
                                        .catch((err) => {
                                            const message = mapActionErrorToMessage(t, err, "chat.renameGroupFailed");
                                            setRenameError(message);
                                            pushToast("error", message);
                                        })
                                        .finally(() => setRenameBusy(false));
                                }}
                                className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                            >
                                {renameBusy ? t("common.loading") : t("common.confirm")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showLeaveConfirm && isGroupChat && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
                            {t("chat.leaveGroupConfirm")}
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowLeaveConfirm(false)}
                                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowLeaveConfirm(false);
                                    onHideRoom?.();
                                }}
                                className="flex-1 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-600"
                            >
                                {t("chat.leaveGroup")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showRoomInfoModal && room && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-base font-semibold text-slate-800 dark:text-slate-100">
                                {t("chat.roomInfo")}
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowRoomInfoModal(false)}
                                className="rounded-full p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                                aria-label={t("common.close")}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="space-y-3 text-sm text-slate-700 dark:text-slate-200">
                            <div>
                                <div className="text-xs uppercase tracking-[0.12em] text-slate-400">
                                    {t("chat.roomId")}
                                </div>
                                <div className="mt-1 break-all">{room?.roomId ?? "-"}</div>
                            </div>
                            <div>
                                <div className="text-xs uppercase tracking-[0.12em] text-slate-400">
                                    {t("chat.roomVersion")}
                                </div>
                                <div className="mt-1">{roomVersion ?? "-"}</div>
                            </div>
                        </div>
                        <div className="mt-4">
                            <button
                                type="button"
                                onClick={() => setShowRoomInfoModal(false)}
                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                {t("common.close")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showRemoveConfirm && memberToRemove && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
                            {t("chat.removeMemberConfirm")}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            {memberToRemove.label}
                        </div>
                        {removeMemberError && <div className="mb-3 text-sm text-rose-500">{removeMemberError}</div>}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowRemoveConfirm(false)}
                                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                type="button"
                                disabled={removeMemberBusy}
                                onClick={() => {
                                    if (!matrixClient || !room || !memberToRemove) return;
                                    setRemoveMemberBusy(true);
                                    setRemoveMemberError(null);
                                    void matrixClient
                                        .kick(room.roomId, memberToRemove.userId, "removed")
                                        .then(() => {
                                            setShowRemoveConfirm(false);
                                            setMemberToRemove(null);
                                        })
                                        .catch((err) => {
                                            const message = mapActionErrorToMessage(t, err, "chat.removeMemberFailed");
                                            setRemoveMemberError(message);
                                            pushToast("error", message);
                                        })
                                        .finally(() => setRemoveMemberBusy(false));
                                }}
                                className="flex-1 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
                            >
                                {removeMemberBusy ? t("common.loading") : t("common.confirm")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {mediaPreview && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
                    onMouseMove={(event) => {
                        if (!draggingRef.current) return;
                        const dx = event.clientX - dragStartRef.current.x;
                        const dy = event.clientY - dragStartRef.current.y;
                        setMediaOffset({ x: dragOriginRef.current.x + dx, y: dragOriginRef.current.y + dy });
                    }}
                    onMouseUp={() => {
                        draggingRef.current = false;
                    }}
                    onMouseLeave={() => {
                        draggingRef.current = false;
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setMediaPreview(null)}
                        className="absolute top-6 right-6 rounded-full bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20"
                    >
                        {t("common.close")}
                    </button>
                    {mediaPreview.type === "image" ? (
                        <div
                            className="max-h-[90vh] max-w-[90vw] cursor-grab"
                            onMouseDown={(event) => {
                                draggingRef.current = true;
                                dragStartRef.current = { x: event.clientX, y: event.clientY };
                                dragOriginRef.current = mediaOffset;
                            }}
                            onWheel={(event) => {
                                event.preventDefault();
                                const next = Math.min(3, Math.max(0.5, mediaZoom - event.deltaY * 0.001));
                                setMediaZoom(next);
                            }}
                        >
                            <img
                                src={mediaPreview.url}
                                alt={t("chat.imageAlt")}
                                className="max-h-[90vh] max-w-[90vw] select-none"
                                style={{
                                    transform: `translate(${mediaOffset.x}px, ${mediaOffset.y}px) scale(${mediaZoom})`,
                                    transition: draggingRef.current ? "none" : "transform 120ms ease",
                                }}
                                draggable={false}
                            />
                        </div>
                    ) : mediaPreview.type === "pdf" ? (
                        <iframe
                            src={mediaPreview.url}
                            title={t("chat.previewPdf")}
                            className="h-[90vh] w-[90vw] rounded-lg bg-white"
                        />
                    ) : (
                        <video src={mediaPreview.url} controls className="max-h-[90vh] max-w-[90vw] rounded-lg" />
                    )}
                </div>
            )}
        </div>
    );
};
