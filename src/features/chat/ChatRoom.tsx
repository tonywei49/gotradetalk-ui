import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
    MagnifyingGlassIcon,
    EllipsisVerticalIcon,
    FaceSmileIcon,
    PaperClipIcon,
    ChevronLeftIcon,
    SparklesIcon,
    ArrowsPointingOutIcon,
    ArrowsPointingInIcon,
    ClockIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import { PaperAirplaneIcon, ChevronDownIcon } from "@heroicons/react/24/solid";
import type { MatrixEvent } from "matrix-js-sdk";
import { EventStatus, EventType, MsgType } from "matrix-js-sdk";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../stores/AuthStore";
import { useRoomTimeline } from "../../matrix/hooks/useRoomTimeline";
import { inviteUsersToRoom, updateRoomInvitePermission } from "../../services/matrix";
import { listContacts, type ContactEntry } from "../../api/contacts";
import { DEPRECATED_DM_PREFIX } from "../../constants/rooms";
import { ROOM_KIND_EVENT } from "../../constants/roomKinds";
import { traceEvent } from "../../utils/debugTrace";
import { mapActionErrorToMessage } from "../../utils/errorMessages";
import { useToastStore } from "../../stores/ToastStore";
import { readUiStateFromSqlite, writeUiStateToSqlite } from "../../desktop/desktopCacheDb";
import {
    isDirectTranslationEnabled as resolveDirectTranslationEnabled,
} from "./translationPolicy";
import {
    pretranslateDirectToClient,
    pretranslateRoomToClients,
    sendReadyAttachments,
    sendTextMessage,
    type ReadyAttachment,
} from "./chatService";
import {
    deriveRoomPermissions,
    hasOneToOneByAccountData,
    hasOneToOneByMembers,
    isOneToOneRoomByPolicy,
    resolveDirectPeerUserId,
    type PowerLevelContent,
} from "./roomMembershipPolicy";
import {
    redactMessageEvent,
    resendMessageEvent,
    scrollbackTimeline,
    sendNoticeMessageEvent,
    sendReadReceiptEvent,
} from "../../matrix/adapters/chatAdapter";
import {
    buildUploadRetryKey,
    parseUploadRetryKey,
    useAttachmentDrafts,
    type PendingAttachment,
} from "./hooks/useAttachmentDrafts";
import { getMessageEventKey, type TranslationDisplayMode, useMessageTranslation } from "./hooks/useMessageTranslation";
import { useNotebookAssist } from "./hooks/useNotebookAssist";
import { MessageActionsMenu } from "./components/MessageActionsMenu";
import { getNotebookAdapter } from "../notebook";
import { mapNotebookErrorToMessage } from "../notebook/notebookErrorMap";
import { buildNotebookAuth } from "../notebook/utils/buildNotebookAuth";
import { TaskQuickCreate, TaskRoomBar, type TaskChatContext } from "../tasks";
import {
    chatSearchLocate,
    chatSearchRoom,
    ChatSearchError,
    type ChatSearchFileHit,
    type ChatSearchMessageHit,
    type ChatSearchRoomResponse,
} from "./chatSearchApi";

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
    senderAvatarUrl?: string | null;
    onOpenMedia: (payload: { url: string; type: "image" | "video" | "pdf" }) => void;
    translatedText?: string | null;
    translationMode?: TranslationDisplayMode;
    translationLoading?: boolean;
    translationError?: boolean;
    translationSuspect?: boolean;
    onSetTranslationMode?: (mode: TranslationDisplayMode) => void;
    onRetryTranslation?: () => void;
    canDeleteFile?: boolean;
    deleteBusy?: boolean;
    onDeleteFile?: (event: MatrixEvent) => void;
    canUseNotebookAssist?: boolean;
    onAssistFromContext?: (anchorEventId: string) => void;
    canUseNotebookBasic?: boolean;
    onSendFileToNotebook?: (event: MatrixEvent) => void;
    sendFileToNotebookBusy?: boolean;
    onCopyMessage?: (event: MatrixEvent, displayText: string) => void;
    onQuoteMessage?: (event: MatrixEvent) => void;
    onRecallMessage?: (event: MatrixEvent) => void;
    allowTranslationActions?: boolean;
};

type QuotedMessageDraft = {
    senderLabel: string;
    preview: string;
};

const DRAFT_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;
const DRAFT_MEDIA_REGISTRY_KEY = "gtt_draft_media_registry_v1";
const CHAT_COMPOSER_DRAFT_KEY_PREFIX = "gtt_chat_composer_draft_v1";
const CHAT_COMPOSER_DRAFT_SCOPE = "chat-composer-draft";
const DRAFT_MEDIA_REGISTRY_SCOPE = "draft-media-registry";
const UPLOAD_RETRY_INTERVAL_MS = 3000;
const UPLOAD_RETRY_MAX_ATTEMPTS = 3;
const ROOM_SEARCH_DEBOUNCE_MS = 350;
const DRAFT_MEDIA_REGISTRY_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const CHAT_COMPOSER_DRAFT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeSourceTitle(rawTitle: string | null | undefined, fallback: string): string {
    const title = String(rawTitle || "").trim();
    if (!title) return fallback;
    return title.replace(/[\r\n]+/g, " ").trim();
}

function parseAssistAnswerLines(answer: string): { summary: string; reference: string } {
    const lines = answer
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) return { summary: "", reference: "" };

    const stripPrefix = (line: string): string => line
        .replace(/^(summary|摘要|總結歸納|总结归纳)\s*[:：]\s*/i, "")
        .replace(/^(reference answer|參考答案|参考答案)\s*[:：]\s*/i, "")
        .trim();

    if (lines.length === 1) {
        return { summary: stripPrefix(lines[0] || ""), reference: "" };
    }

    return {
        summary: stripPrefix(lines[0] || ""),
        reference: stripPrefix(lines[1] || ""),
    };
}

function formatMatrixUserLocalId(matrixUserId: string | null | undefined): string {
    const raw = String(matrixUserId || "").trim();
    if (!raw) return "";
    const withoutPrefix = raw.startsWith("@") ? raw.slice(1) : raw;
    const colonIndex = withoutPrefix.indexOf(":");
    if (colonIndex <= 0) return withoutPrefix;
    return withoutPrefix.slice(0, colonIndex);
}

type DraftMediaRegistryEntry = {
    mxcUrl: string;
    createdAt: number;
    ownerUserId: string;
};

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

function formatMessageTimestampLabel(ts: number): string {
    const date = new Date(ts);
    const now = new Date();
    const isToday =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
    if (isToday) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function formatTypingIndicatorLabel(labels: string[], t: ReturnType<typeof useTranslation>["t"]): string {
    if (labels.length === 0) return "";
    if (labels.length === 1) {
        return t("chat.typingSingle", { name: labels[0] });
    }
    if (labels.length === 2) {
        return t("chat.typingPair", { first: labels[0], second: labels[1] });
    }
    return t("chat.typingMultiple", { name: labels[0], count: labels.length - 1 });
}

function sanitizeQuoteText(value: string): string {
    return value
        .replace(/\s+/g, " ")
        .replace(/^>+\s*/g, "")
        .trim();
}

function getQuotedMessagePreview(event: MatrixEvent, fallbackText?: string): string {
    const content = event.getContent() as { body?: string; msgtype?: string; info?: { duration?: number } } | undefined;
    const body = sanitizeQuoteText(String(fallbackText || content?.body || ""));
    const durationSeconds = Math.max(1, Math.round((content?.info?.duration || 0) / 1000));

    switch (content?.msgtype) {
        case MsgType.Image:
            return body ? `[圖片] ${body}` : "[圖片]";
        case MsgType.Video:
            return body ? `[影片] ${body}` : "[影片]";
        case MsgType.Audio:
            return durationSeconds > 0 ? `[語音] ${durationSeconds}秒` : "[語音]";
        case MsgType.File:
            return body ? `[檔案] ${body}` : "[檔案]";
        default:
            return body;
    }
}

function buildQuotedMessageBody(quote: QuotedMessageDraft, nextText: string): string {
    const preview = sanitizeQuoteText(quote.preview);
    const safeLines = preview
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3);
    const quoteBlock = safeLines.length > 0
        ? safeLines.map((line) => `> ${line}`).join("\n")
        : "> ";
    const senderLine = `> ${quote.senderLabel}`;
    return `${senderLine}\n${quoteBlock}\n\n${nextText.trim()}`;
}

const MessageBubble = ({
    event,
    isMe,
    status,
    onResend,
    mediaUrl,
    senderLabel,
    senderAvatarUrl,
    onOpenMedia,
    translatedText,
    translationMode,
    translationLoading,
    translationError,
    translationSuspect,
    onSetTranslationMode,
    onRetryTranslation,
    canDeleteFile,
    deleteBusy,
    onDeleteFile,
    canUseNotebookAssist,
    onAssistFromContext,
    canUseNotebookBasic,
    onSendFileToNotebook,
    sendFileToNotebookBusy,
    onCopyMessage,
    onQuoteMessage,
    onRecallMessage,
    allowTranslationActions = true,
}: MessageBubbleProps) => {
    const { t } = useTranslation();
    const [showFileMenu, setShowFileMenu] = useState(false);
    const [showQuickActionMenu, setShowQuickActionMenu] = useState(false);
    const [showQuickActionMenuUpward, setShowQuickActionMenuUpward] = useState(false);
    const [showFileMenuUpward, setShowFileMenuUpward] = useState(false);
    const quickActionMenuRef = useRef<HTMLDivElement | null>(null);
    const fileMenuRef = useRef<HTMLDivElement | null>(null);
    const quickActionButtonRef = useRef<HTMLButtonElement | null>(null);
    const fileActionButtonRef = useRef<HTMLButtonElement | null>(null);
    const content = event.getContent() as { body?: string; msgtype?: string; info?: { mimetype?: string } } | undefined;
    const messageText = content?.body ?? "";
    const isSending =
        status === EventStatus.SENDING || status === EventStatus.ENCRYPTING || status === EventStatus.QUEUED;
    const isFailed = status === EventStatus.NOT_SENT;
    const timeLabel = formatMessageTimestampLabel(event.getTs());
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
    const effectiveTranslationMode: TranslationDisplayMode = translationMode ?? "original";
    const showTranslated = Boolean(isText && effectiveTranslationMode === "translated");
    const showBilingual = Boolean(isText && effectiveTranslationMode === "bilingual");
    const hasTranslatedText = Boolean((translatedText ?? "").trim());
    const showUnavailableInline = Boolean(
        isText && (showTranslated || showBilingual) && !translationLoading && !hasTranslatedText && translationError,
    );
    const anchorEventId = event.getId();
    const canToggleTranslation = Boolean(allowTranslationActions && isText && !isMe && onSetTranslationMode);
    const canRetryTranslation = Boolean(
        allowTranslationActions && isText && !isMe && onRetryTranslation && (translationError || translationSuspect),
    );
    const canAssistFromContext = Boolean(
        canUseNotebookAssist &&
        isText &&
        event.getType() === EventType.RoomMessage &&
        content?.msgtype !== MsgType.Notice &&
        anchorEventId &&
        onAssistFromContext,
    );
    const rawMxc = typeof (content as { url?: unknown } | undefined)?.url === "string"
        ? String((content as { url?: string }).url)
        : "";
    const canSendFileToNotebook = Boolean(
        canUseNotebookBasic &&
        isFileLike &&
        !isAudioMsg &&
        rawMxc.startsWith("mxc://") &&
        onSendFileToNotebook,
    );
    const canRecallMessage = Boolean(
        onRecallMessage &&
        isMe &&
        event.getType() === EventType.RoomMessage &&
        content?.msgtype !== MsgType.Notice &&
        event.getId(),
    );
    const canQuoteMessage = Boolean(onQuoteMessage);
    const hasQuickActions = Boolean(onCopyMessage) || canQuoteMessage || canToggleTranslation || canAssistFromContext || canSendFileToNotebook || canRecallMessage;
    const displayText = showTranslated
        ? hasTranslatedText
            ? (translatedText as string)
            : translationLoading
                ? t("chat.translationPending")
                : messageText
        : messageText;

    useEffect(() => {
        if (!showQuickActionMenu && !showFileMenu) return;
        const onPointerDown = (event: MouseEvent | TouchEvent): void => {
            const target = event.target as Node | null;
            if (!target) return;
            if (showQuickActionMenu && quickActionMenuRef.current && !quickActionMenuRef.current.contains(target)) {
                setShowQuickActionMenu(false);
            }
            if (showFileMenu && fileMenuRef.current && !fileMenuRef.current.contains(target)) {
                setShowFileMenu(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("touchstart", onPointerDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("touchstart", onPointerDown);
        };
    }, [showQuickActionMenu, showFileMenu]);

    useEffect(() => {
        if (!showQuickActionMenu) return;
        const trigger = quickActionButtonRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const estimatedMenuHeight = 220;
        setShowQuickActionMenuUpward(window.innerHeight - rect.bottom < estimatedMenuHeight);
    }, [showQuickActionMenu]);

    useEffect(() => {
        if (!showFileMenu) return;
        const trigger = fileActionButtonRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const estimatedMenuHeight = 80;
        setShowFileMenuUpward(window.innerHeight - rect.bottom < estimatedMenuHeight);
    }, [showFileMenu]);

    return (
        <div className={`flex w-full mb-3 ${isMe ? "justify-end" : "justify-start"} ${isSending ? "opacity-60" : ""}`}>
            {/* Avatar (Incoming only) */}
            {!isMe && (
                senderAvatarUrl ? (
                    <img src={senderAvatarUrl} alt={senderLabel} className="w-8 h-8 rounded-full object-cover mr-3 flex-shrink-0 self-start mt-1" />
                ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-300 mr-3 flex-shrink-0 self-start mt-1" />
                )
            )}

            <div className={`flex flex-col max-w-[70%] ${isMe ? "items-end" : "items-start"}`}>
                {/* Sender Name (Incoming only) */}
                {!isMe && (
                    <div className="mb-1 ml-1 flex items-center gap-2 text-[11px] text-gray-500 dark:text-slate-400">
                        <span>{senderLabel}</span>
                        <span className="text-[10px] text-gray-400 dark:text-slate-500">{timeLabel}</span>
                    </div>
                )}

                <div className="flex items-end gap-2">
                    {isMe && hasQuickActions && (
                        <div ref={quickActionMenuRef} className="relative self-end mb-1">
                            <button
                                ref={quickActionButtonRef}
                                type="button"
                                onClick={() => setShowQuickActionMenu((prev) => !prev)}
                                className="rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                aria-label={t("chat.messageActions")}
                            >
                                <EllipsisVerticalIcon className="h-4 w-4" />
                            </button>
                            {showQuickActionMenu && (
                                <MessageActionsMenu
                                    canToggleTranslation={canToggleTranslation}
                                    translationLoading={translationLoading}
                                    translationMode={effectiveTranslationMode}
                                    canRetryTranslation={canRetryTranslation}
                                    canQuoteMessage={canQuoteMessage}
                                    canAssistFromContext={Boolean(canAssistFromContext && anchorEventId)}
                                    canSendFileToNotebook={canSendFileToNotebook}
                                    sendFileToNotebookBusy={sendFileToNotebookBusy}
                                    openUpward={showQuickActionMenuUpward}
                                    align="right"
                                    onSetTranslationMode={(mode) => {
                                        setShowQuickActionMenu(false);
                                        onSetTranslationMode?.(mode);
                                    }}
                                    onRetryTranslation={() => {
                                        setShowQuickActionMenu(false);
                                        onRetryTranslation?.();
                                    }}
                                    onCopyMessage={() => {
                                        setShowQuickActionMenu(false);
                                        onCopyMessage?.(event, displayText);
                                    }}
                                    onQuoteMessage={() => {
                                        setShowQuickActionMenu(false);
                                        onQuoteMessage?.(event);
                                    }}
                                    onAssistFromContext={() => {
                                        if (!anchorEventId) return;
                                        setShowQuickActionMenu(false);
                                        onAssistFromContext?.(anchorEventId);
                                    }}
                                    onSendFileToNotebook={() => {
                                        setShowQuickActionMenu(false);
                                        onSendFileToNotebook?.(event);
                                    }}
                                    canRecallMessage={canRecallMessage}
                                    onRecallMessage={() => {
                                        setShowQuickActionMenu(false);
                                        onRecallMessage?.(event);
                                    }}
                                />
                            )}
                        </div>
                    )}
                    {isMe && isFileLike && canDeleteFile && onDeleteFile && (
                        <div ref={fileMenuRef} className="relative self-end mb-1">
                            <button
                                ref={fileActionButtonRef}
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
                                <div className={`absolute right-0 z-20 w-24 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
                                    showFileMenuUpward ? "bottom-full mb-1" : "top-full mt-1"
                                }`}>
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
                            <div className="space-y-2">
                                <audio controls preload="metadata" className="w-64">
                                    <source src={mediaUrl} type={content?.info?.mimetype || undefined} />
                                </audio>
                                <a
                                    href={mediaUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`text-[11px] underline ${
                                        isMe ? "text-emerald-100" : "text-slate-500 dark:text-slate-300"
                                    }`}
                                >
                                    {t("chat.downloadFile")} {messageText || "audio"}
                                </a>
                            </div>
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
                        ) : isText && showBilingual ? (
                            <div className="space-y-2">
                                <MessageMarkdown text={messageText} isMe={isMe} />
                                <div className={`rounded-md px-2 py-1 ${isMe ? "bg-white/10" : "bg-slate-100 dark:bg-slate-700"}`}>
                                    {translationLoading ? (
                                        <TranslationTypingIndicator isMe={isMe} />
                                    ) : hasTranslatedText ? (
                                        <MessageMarkdown text={translatedText as string} isMe={isMe} />
                                    ) : translationError ? (
                                        <span className={`text-[11px] ${isMe ? "text-emerald-100/80" : "text-slate-500 dark:text-slate-300"}`}>
                                            {t("chat.translationUnavailable")}
                                        </span>
                                    ) : (
                                        <span className={`text-[11px] ${isMe ? "text-emerald-100/80" : "text-slate-500 dark:text-slate-300"}`}>
                                            {t("chat.translationPending")}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ) : isText && showTranslated && translationLoading ? (
                            <TranslationTypingIndicator isMe={isMe} />
                        ) : (
                            <MessageMarkdown text={displayText} isMe={isMe} />
                        )}
                    </div>

                    {!isMe && hasQuickActions && (
                        <div ref={quickActionMenuRef} className="relative self-end mb-1">
                            <button
                                ref={quickActionButtonRef}
                                type="button"
                                onClick={() => setShowQuickActionMenu((prev) => !prev)}
                                className="rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                aria-label={t("chat.messageActions")}
                            >
                                <EllipsisVerticalIcon className="h-4 w-4" />
                            </button>
                            {showQuickActionMenu && (
                                <MessageActionsMenu
                                    canToggleTranslation={canToggleTranslation}
                                    translationLoading={translationLoading}
                                    translationMode={effectiveTranslationMode}
                                    canRetryTranslation={canRetryTranslation}
                                    canQuoteMessage={canQuoteMessage}
                                    canAssistFromContext={Boolean(canAssistFromContext && anchorEventId)}
                                    canSendFileToNotebook={canSendFileToNotebook}
                                    sendFileToNotebookBusy={sendFileToNotebookBusy}
                                    openUpward={showQuickActionMenuUpward}
                                    align="left"
                                    onSetTranslationMode={(mode) => {
                                        setShowQuickActionMenu(false);
                                        onSetTranslationMode?.(mode);
                                    }}
                                    onRetryTranslation={() => {
                                        setShowQuickActionMenu(false);
                                        onRetryTranslation?.();
                                    }}
                                    onCopyMessage={() => {
                                        setShowQuickActionMenu(false);
                                        onCopyMessage?.(event, displayText);
                                    }}
                                    onQuoteMessage={() => {
                                        setShowQuickActionMenu(false);
                                        onQuoteMessage?.(event);
                                    }}
                                    onAssistFromContext={() => {
                                        if (!anchorEventId) return;
                                        setShowQuickActionMenu(false);
                                        onAssistFromContext?.(anchorEventId);
                                    }}
                                    onSendFileToNotebook={() => {
                                        setShowQuickActionMenu(false);
                                        onSendFileToNotebook?.(event);
                                    }}
                                    canRecallMessage={canRecallMessage}
                                    onRecallMessage={() => {
                                        setShowQuickActionMenu(false);
                                        onRecallMessage?.(event);
                                    }}
                                />
                            )}
                        </div>
                    )}
                    {!isMe && isFileLike && canDeleteFile && onDeleteFile && (
                        <div ref={fileMenuRef} className="relative self-end mb-1">
                            <button
                                ref={fileActionButtonRef}
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
                                <div className={`absolute z-20 w-24 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
                                    showFileMenuUpward ? "bottom-full left-0 mb-1" : "top-full left-0 mt-1"
                                }`}>
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
            {showUnavailableInline && (
                <div className="mt-1 flex items-center gap-2 text-[11px] text-emerald-600 dark:text-emerald-300">
                    {t("chat.translationUnavailable")}
                    {onRetryTranslation && (
                        <button
                            type="button"
                            className="rounded border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-700 hover:bg-emerald-50 dark:border-emerald-300/40 dark:text-emerald-200 dark:hover:bg-emerald-900/20"
                            onClick={onRetryTranslation}
                            disabled={translationLoading}
                        >
                            {t("chat.retryTranslation")}
                        </button>
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
    onLeaveRoom?: () => void;
    onTogglePin?: () => void;
    isRoomPinned?: boolean;
    chatReceiveLanguage?: string;
    translationDefaultView?: "translated" | "original" | "bilingual";
    companyName?: string | null;
    jumpToEventId?: string | null;
    onJumpHandled?: () => void;
    notebookAssistEnabled?: boolean;
    notebookCapabilities?: string[];
    notebookCapabilityError?: string | null;
    onRetryNotebookCapability?: () => void;
    onReloginForNotebook?: () => void;
    hasNotebookAuthToken?: boolean;
    notebookApiBaseUrl?: string | null;
} & TaskChatContext;

type RemoveTarget = {
    userId: string;
    label: string;
    membership: "join" | "invite";
};

type MentionCandidate = {
    userId: string;
    localpart: string;
    label: string;
};

function extractActiveMention(text: string, cursor: number): { start: number; end: number; query: string } | null {
    const safeCursor = Math.max(0, Math.min(cursor, text.length));
    const beforeCursor = text.slice(0, safeCursor);
    const match = /(?:^|\s)@([a-zA-Z0-9._-]*)$/.exec(beforeCursor);
    if (!match) return null;
    const query = match[1] ?? "";
    const atIndex = safeCursor - query.length - 1;
    if (atIndex < 0) return null;
    return {
        start: atIndex,
        end: safeCursor,
        query: query.toLowerCase(),
    };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
        onLeaveRoom,
        onTogglePin,
        isRoomPinned,
        chatReceiveLanguage,
        translationDefaultView,
        companyName,
        jumpToEventId,
        onJumpHandled,
        notebookAssistEnabled,
        notebookCapabilities,
        notebookCapabilityError,
        onRetryNotebookCapability,
        onReloginForNotebook,
        hasNotebookAuthToken,
        notebookApiBaseUrl,
        taskStatuses,
        roomTasks,
        taskQuickDraft,
        onTaskQuickDraftChange,
        onCreateRoomTask,
        onOpenTasksTab,
        onUpdateRoomTaskStatus,
    } =
        useOutletContext<ChatRoomContext>();
    const matrixClient = useAuthStore((state) => state.matrixClient);
    const matrixCredentials = useAuthStore((state) => state.matrixCredentials);
    const userId = useAuthStore((state) => state.matrixCredentials?.user_id ?? null);
    const hubSession = useAuthStore((state) => state.hubSession);
    const userType = useAuthStore((state) => state.userType);
    const { events, room, showingCachedEvents } = useRoomTimeline(matrixClient, activeRoomId, { limit: 20 });
    const timelineRef = useRef<HTMLDivElement | null>(null);
    const roomStickBottomRef = useRef<Record<string, boolean>>({});
    const historyScrollAnchorRef = useRef<{
        roomId: string;
        previousScrollHeight: number;
        previousScrollTop: number;
        previousEventCount: number;
    } | null>(null);
    const suppressAutoStickBottomRef = useRef(false);
    const previousRoomIdRef = useRef<string | null>(null);
    const skipRoomResetOnFirstMountRef = useRef(true);
    const lastReadReceiptEventByRoomRef = useRef<Record<string, string>>({});
    const [composerText, setComposerText] = useState("");
    const [quotedMessage, setQuotedMessage] = useState<QuotedMessageDraft | null>(null);
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
    const [activeMention, setActiveMention] = useState<{ start: number; end: number; query: string } | null>(null);
    const [activeMentionIndex, setActiveMentionIndex] = useState(0);
    const [typingMemberLabels, setTypingMemberLabels] = useState<string[]>([]);
    const [showTaskQuickCreate, setShowTaskQuickCreate] = useState(false);
    const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([]);
    const actionsMenuRef = useRef<HTMLDivElement | null>(null);
    const actionsButtonRef = useRef<HTMLButtonElement | null>(null);
    const emojiBoardRef = useRef<HTMLDivElement | null>(null);
    const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
    const roomSearchButtonRef = useRef<HTMLButtonElement | null>(null);
    const roomSearchPanelRef = useRef<HTMLDivElement | null>(null);
    const composerRef = useRef<HTMLTextAreaElement | null>(null);
    const mentionMenuRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const retryFileInputRef = useRef<HTMLInputElement | null>(null);
    const typingIdleTimerRef = useRef<number | null>(null);
    const typingHeartbeatTimerRef = useRef<number | null>(null);
    const typingRoomRef = useRef<string | null>(null);
    const typingLastSentAtRef = useRef(0);
    const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
    const [showRoomSearchPanel, setShowRoomSearchPanel] = useState(false);
    const [roomSearchQuery, setRoomSearchQuery] = useState("");
    const [debouncedRoomSearchQuery, setDebouncedRoomSearchQuery] = useState("");
    const [roomSearchType, setRoomSearchType] = useState<"all" | "messages" | "files">("messages");
    const [roomSearchFrom, setRoomSearchFrom] = useState("");
    const [roomSearchTo, setRoomSearchTo] = useState("");
    const [roomSearchLoading, setRoomSearchLoading] = useState(false);
    const [roomSearchError, setRoomSearchError] = useState<string | null>(null);
    const [roomSearchResult, setRoomSearchResult] = useState<ChatSearchRoomResponse | null>(null);
    const [roomSearchCursor, setRoomSearchCursor] = useState<string | null>(null);
    const [assistSending, setAssistSending] = useState(false);
    const [assistEditorRows, setAssistEditorRows] = useState(5);
    const [assistEditorFullscreen, setAssistEditorFullscreen] = useState(false);
    const [draftMediaRegistryReady, setDraftMediaRegistryReady] = useState(false);
    const composerDraftStorageKey = useMemo(
        () => (activeRoomId ? `${CHAT_COMPOSER_DRAFT_KEY_PREFIX}:${activeRoomId}` : ""),
        [activeRoomId],
    );
    const composerDraftSqliteKey = useMemo(
        () => (matrixCredentials?.user_id && activeRoomId ? `${matrixCredentials.user_id}:${activeRoomId}` : null),
        [activeRoomId, matrixCredentials?.user_id],
    );
    const draftMediaRegistrySqliteKey = useMemo(() => matrixCredentials?.user_id ?? null, [matrixCredentials?.user_id]);
    const hubAccessToken = hubSession?.access_token ?? null;
    const hubSessionExpiresAt = hubSession?.expires_at ?? null;
    const matrixAccessToken = matrixCredentials?.access_token ?? null;
    const matrixHsUrl = matrixCredentials?.hs_url ?? null;
    const inviteTokenExpired = hubSessionExpiresAt ? hubSessionExpiresAt * 1000 <= Date.now() : false;
    const useHubToken = userType === "client" && hubAccessToken && !inviteTokenExpired;
    const useHubTokenForTranslate = userType === "client" && hubAccessToken && !inviteTokenExpired;
    const inviteAccessToken = useHubToken ? hubAccessToken : matrixAccessToken;
    const inviteHsUrl = useHubToken ? null : matrixHsUrl;
    const translateAccessToken = useHubTokenForTranslate ? hubAccessToken : matrixAccessToken;
    const translateHsUrl = useHubTokenForTranslate ? null : matrixHsUrl;
    const translateMatrixUserId = matrixCredentials?.user_id ?? null;
    const notebookAdapter = useMemo(() => getNotebookAdapter(), []);
    const { notebookAuth } = useMemo(() => buildNotebookAuth({
        hubSession,
        matrixCredentials,
        userType,
        capabilities: notebookCapabilities,
        apiBaseUrl: notebookApiBaseUrl,
    }), [hubSession, matrixCredentials, userType, notebookCapabilities, notebookApiBaseUrl]);
    const canUseNotebookAssist = Boolean(notebookAssistEnabled && notebookAuth);
    const canUseNotebookBasic = Boolean(notebookAuth && notebookCapabilities?.includes("NOTEBOOK_BASIC"));
    const {
        assistState,
        assistError,
        assistOutput,
        assistDraft,
        setAssistDraft,
        assistCitationsExpanded,
        setAssistCitationsExpanded,
        lastAssistTrigger,
        setLastAssistTrigger,
        assistLowConfidence,
        runAssistQuery,
        runAssistFromContext,
        resetAssist,
    } = useNotebookAssist({
        adapter: notebookAdapter,
        notebookAuth,
        activeRoomId,
        canUseNotebookAssist,
        responseLang: chatReceiveLanguage,
        knowledgeScope: "both",
        t,
    });
    const assistSourceMap = useMemo(() => {
        const map = new Map<string, { title: string; snippet: string; sourceScope?: "personal" | "company"; sourceFileName?: string | null }>();
        (assistOutput?.sources || []).forEach((source, index) => {
            const label = source.title || source.itemId;
            map.set(`${source.itemId}:${index + 1}`, {
                title: label,
                snippet: source.snippet || "",
                sourceScope: source.sourceScope,
                sourceFileName: source.sourceFileName || null,
            });
            if (!map.has(source.itemId)) {
                map.set(source.itemId, {
                    title: label,
                    snippet: source.snippet || "",
                    sourceScope: source.sourceScope,
                    sourceFileName: source.sourceFileName || null,
                });
            }
        });
        return map;
    }, [assistOutput?.sources]);
    const assistAnswerFallback = useMemo(
        () => parseAssistAnswerLines(assistOutput?.answer || ""),
        [assistOutput?.answer],
    );
    const assistSummaryText = (assistDraft || assistOutput?.summaryText || assistAnswerFallback.summary || assistOutput?.answer || "").trim();
    const assistReferenceAnswer = (assistOutput?.referenceAnswer || assistAnswerFallback.reference || assistSummaryText || assistOutput?.answer || "").trim();
    const [sendingFileToNotebookEventId, setSendingFileToNotebookEventId] = useState<string | null>(null);
    const {
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
    } = useAttachmentDrafts({
        userId,
        activeRoomId,
        uploadInterruptedNeedsReselectText: t("chat.uploadInterruptedNeedsReselect"),
    });

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
        let disposed = false;
        void readUiStateFromSqlite<DraftMediaRegistryEntry[]>(
            DRAFT_MEDIA_REGISTRY_SCOPE,
            draftMediaRegistrySqliteKey,
            DRAFT_MEDIA_REGISTRY_CACHE_TTL_MS,
        )
            .then((cached) => {
                if (disposed || !Array.isArray(cached)) return;
                writeDraftMediaRegistry(cached);
            })
            .catch(() => undefined)
            .finally(() => {
                if (!disposed) {
                    setDraftMediaRegistryReady(true);
                }
            });
        return () => {
            disposed = true;
        };
    }, [draftMediaRegistrySqliteKey]);

    useEffect(() => {
        if (!matrixCredentials?.hs_url || !matrixCredentials.access_token || !userId) return;
        if (!draftMediaRegistryReady) return;
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
    }, [draftMediaRegistryReady, matrixCredentials?.hs_url, matrixCredentials?.access_token, userId]);

    useEffect(() => {
        if (!draftMediaRegistryReady) return;
        void writeUiStateToSqlite(DRAFT_MEDIA_REGISTRY_SCOPE, draftMediaRegistrySqliteKey, readDraftMediaRegistry());
    }, [draftMediaRegistryReady, draftMediaRegistrySqliteKey, pendingAttachmentsByRoom]);
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
    const updateTypingMemberLabels = useCallback(() => {
        if (!room || !userId) {
            setTypingMemberLabels([]);
            return;
        }
        const labels = room
            .getMembers()
            .filter((member) => member.typing && member.userId !== userId)
            .map((member) => getUserLabel(member.userId, member.name))
            .filter(Boolean);
        setTypingMemberLabels(labels);
    }, [room, userId]);
    const stopTypingNotice = useCallback((roomId?: string | null) => {
        if (typingIdleTimerRef.current) {
            window.clearTimeout(typingIdleTimerRef.current);
            typingIdleTimerRef.current = null;
        }
        if (typingHeartbeatTimerRef.current) {
            window.clearInterval(typingHeartbeatTimerRef.current);
            typingHeartbeatTimerRef.current = null;
        }
        const targetRoomId = typingRoomRef.current ?? roomId ?? null;
        if (matrixClient && targetRoomId) {
            void matrixClient.sendTyping(targetRoomId, false, 0).catch(() => undefined);
        }
        typingRoomRef.current = null;
        typingLastSentAtRef.current = 0;
    }, [matrixClient]);
    const startTypingNotice = useCallback((roomId: string) => {
        if (!matrixClient || !userId) return;
        const now = Date.now();
        const shouldSend =
            typingRoomRef.current !== roomId || now - typingLastSentAtRef.current >= 3000;
        if (typingRoomRef.current && typingRoomRef.current !== roomId) {
            void matrixClient.sendTyping(typingRoomRef.current, false, 0).catch(() => undefined);
        }
        typingRoomRef.current = roomId;
        if (shouldSend) {
            typingLastSentAtRef.current = now;
            void matrixClient.sendTyping(roomId, true, 5000).catch(() => undefined);
        }
        if (!typingHeartbeatTimerRef.current) {
            typingHeartbeatTimerRef.current = window.setInterval(() => {
                if (!typingRoomRef.current) return;
                typingLastSentAtRef.current = Date.now();
                void matrixClient.sendTyping(typingRoomRef.current, true, 5000).catch(() => undefined);
            }, 4000);
        }
    }, [matrixClient, userId]);
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
        if (skipRoomResetOnFirstMountRef.current) {
            skipRoomResetOnFirstMountRef.current = false;
            return;
        }
        resetAssist();
        setLastAssistTrigger(null);
        setAssistEditorRows(5);
        setAssistEditorFullscreen(false);
    }, [activeRoomId, resetAssist, setLastAssistTrigger]);

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

    useEffect(() => {
        if (!activeMention) return;
        const onPointerDown = (event: MouseEvent): void => {
            const target = event.target as Node;
            if (mentionMenuRef.current?.contains(target) || composerRef.current?.contains(target)) return;
            setActiveMention(null);
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [activeMention]);

    useEffect(() => {
        if (!composerDraftStorageKey) {
            setComposerText("");
            return;
        }
        let disposed = false;

        try {
            const cached = window.sessionStorage.getItem(composerDraftStorageKey) || "";
            if (cached) {
                setComposerText(cached);
            } else {
                setComposerText("");
            }
        } catch {
            setComposerText("");
        }

        void readUiStateFromSqlite<string>(
            CHAT_COMPOSER_DRAFT_SCOPE,
            composerDraftSqliteKey,
            CHAT_COMPOSER_DRAFT_CACHE_TTL_MS,
        )
            .then((cached) => {
                if (disposed || typeof cached !== "string") return;
                setComposerText(cached);
            })
            .catch(() => undefined);

        return () => {
            disposed = true;
        };
    }, [composerDraftSqliteKey, composerDraftStorageKey]);

    useEffect(() => {
        if (!composerDraftStorageKey) return;
        try {
            const trimmed = composerText.trim();
            if (!trimmed) {
                window.sessionStorage.removeItem(composerDraftStorageKey);
            } else {
                window.sessionStorage.setItem(composerDraftStorageKey, composerText);
            }
        } catch {
            // ignore storage errors
        }
        void writeUiStateToSqlite(CHAT_COMPOSER_DRAFT_SCOPE, composerDraftSqliteKey, composerText);
    }, [composerDraftSqliteKey, composerDraftStorageKey, composerText]);

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

    const targetLanguage = (chatReceiveLanguage || "").trim();
    const canTranslate = Boolean(translateAccessToken && targetLanguage);

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
    const resolveContactByMatrixUserId = useCallback((matrixUserId?: string | null): ContactEntry | null => {
        if (!matrixUserId) return null;
        return contactLookup.get(matrixUserId) ?? null;
    }, [contactLookup]);

    const roomKind = useMemo(() => {
        if (!room) return null;
        const kindEvent = room.currentState.getStateEvents(ROOM_KIND_EVENT, "");
        return (kindEvent?.getContent() as { kind?: string } | undefined)?.kind ?? null;
    }, [room]);
    const isDirectByAccountData = useMemo(() => {
        if (!matrixClient || !activeRoomId) return false;
        const event = matrixClient.getAccountData("m.direct" as never);
        const content = event?.getContent() as Record<string, unknown> | undefined;
        return hasOneToOneByAccountData(content, activeRoomId);
    }, [activeRoomId, matrixClient]);
    const isDirectByMembers = useMemo(() => {
        if (!room) return false;
        return hasOneToOneByMembers({
            isSpaceRoom: room.isSpaceRoom(),
            joinedMemberIds: room.getJoinedMembers().map((member) => member.userId),
            invitedMemberIds: room.getMembersWithMembership("invite").map((member) => member.userId),
            selfUserId: userId,
        });
    }, [room, userId]);
    const isDirectRoom = useMemo(() => {
        return isOneToOneRoomByPolicy({
            isSpaceRoom: Boolean(room?.isSpaceRoom()),
            roomKind,
            isDirectByAccountData,
            isDirectByMembers,
        });
    }, [isDirectByAccountData, isDirectByMembers, room, roomKind]);
    const isMultiMemberRoom = Boolean(room) && !room?.isSpaceRoom() && !isDirectRoom;
    const canManageRoom = Boolean(room) && !room?.isSpaceRoom();
    const canLeaveRoom = canManageRoom;
    const directPeerUserId = useMemo(() => {
        if (!room || !isDirectRoom) return null;
        return resolveDirectPeerUserId(
            room.getJoinedMembers().map((member) => member.userId),
            room.getMembersWithMembership("invite").map((member) => member.userId),
            userId,
        );
    }, [isDirectRoom, room, userId]);
    const isDirectPeerAbsent = Boolean(isDirectRoom && !directPeerUserId);
    const directPeerContact = useMemo(() => {
        if (!directPeerUserId) return null;
        return resolveContactByMatrixUserId(directPeerUserId);
    }, [directPeerUserId, resolveContactByMatrixUserId]);
    const directTranslationEnabled = useMemo(() => {
        return resolveDirectTranslationEnabled({
            isDirectRoom,
            userType,
            directPeerContact,
            companyName,
        });
    }, [companyName, directPeerContact, isDirectRoom, userType]);
    const roomTranslationEnabled = useMemo(() => {
        if (!isMultiMemberRoom) return false;
        return true;
    }, [isMultiMemberRoom]);

    const { translationMap, translationView, setTranslationView, requestTranslation } = useMessageTranslation({
        activeRoomId,
        room,
        mergedEvents,
        userId,
        canTranslate,
        targetLanguage,
        translationDefaultView,
        translateAccessToken,
        translateHsUrl,
        translateMatrixUserId,
        isDirectRoom,
        isMultiMemberRoom,
        directTranslationEnabled,
        roomTranslationEnabled,
        userType,
        companyName,
        resolveContactByMatrixUserId,
        pushToast,
        translationUnavailableText: t("chat.translationUnavailable"),
    });

    const canSendReceipt = (event: MatrixEvent | undefined): event is MatrixEvent => {
        const eventId = event?.getId();
        return Boolean(eventId && eventId.startsWith("$"));
    };

    const sendReadReceiptIfNeeded = (event: MatrixEvent | undefined): void => {
        if (!matrixClient || !activeRoomId || !canSendReceipt(event)) return;
        const eventId = event.getId() as string;
        if (lastReadReceiptEventByRoomRef.current[activeRoomId] === eventId) return;
        lastReadReceiptEventByRoomRef.current[activeRoomId] = eventId;
        void sendReadReceiptEvent(matrixClient, event);
    };

    const isDeprecatedRoom = Boolean(isDirectRoom && room?.name?.startsWith(DEPRECATED_DM_PREFIX));
    useEffect(() => {
        updateTypingMemberLabels();
        if (!matrixClient) return;
        const handleTyping = (): void => {
            updateTypingMemberLabels();
        };
        matrixClient.on("RoomMember.typing" as never, handleTyping as never);
        return () => {
            matrixClient.off("RoomMember.typing" as never, handleTyping as never);
        };
    }, [matrixClient, updateTypingMemberLabels]);

    useEffect(() => {
        if (!activeRoomId || isDeprecatedRoom || isDirectPeerAbsent) {
            stopTypingNotice();
            return;
        }
        const hasDraft = composerText.trim().length > 0;
        if (!hasDraft) {
            stopTypingNotice(activeRoomId);
            return;
        }
        startTypingNotice(activeRoomId);
        if (typingIdleTimerRef.current) {
            window.clearTimeout(typingIdleTimerRef.current);
        }
        typingIdleTimerRef.current = window.setTimeout(() => {
            stopTypingNotice(activeRoomId);
        }, 2000);
        return () => {
            if (typingIdleTimerRef.current) {
                window.clearTimeout(typingIdleTimerRef.current);
                typingIdleTimerRef.current = null;
            }
        };
    }, [activeRoomId, composerText, isDeprecatedRoom, isDirectPeerAbsent, startTypingNotice, stopTypingNotice]);

    useEffect(() => () => stopTypingNotice(), [stopTypingNotice]);

    const joinedMembers = room?.getJoinedMembers() ?? [];
    const invitedMembers = room?.getMembersWithMembership("invite") ?? [];
    const memberCount = joinedMembers.length;
    const invitedCount = invitedMembers.length;
    const isSoloInRoom = Boolean(isMultiMemberRoom && memberCount === 1);
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
    const roomPermissions = useMemo(() => deriveRoomPermissions(powerLevels, userId), [powerLevels, userId]);
    const inviteLevel = roomPermissions.inviteLevel;
    const canManageInvites = roomPermissions.canManageInvites;
    const canInviteMembers = roomPermissions.canInviteMembers;
    const canRenameRoom = roomPermissions.canRenameRoom ?? roomPermissions.canRenameGroup;
    const canRemoveMembers = roomPermissions.canRemoveMembers;
    const memberIdSet = useMemo(() => new Set(joinedMembers.map((member) => member.userId)), [joinedMembers]);
    const mentionCandidates = useMemo((): MentionCandidate[] => {
        const seen = new Set<string>();
        return [...joinedMembers, ...invitedMembers]
            .filter((member) => member.userId && member.userId !== userId)
            .map((member) => {
                const localpart = getLocalPart(member.userId);
                return {
                    userId: member.userId,
                    localpart,
                    label: getUserLabel(member.userId, member.name || member.rawDisplayName),
                };
            })
            .filter((item) => {
                if (!item.localpart) return false;
                if (seen.has(item.userId)) return false;
                seen.add(item.userId);
                return true;
            })
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [joinedMembers, invitedMembers, userId]);
    const visibleMentionCandidates = useMemo(() => {
        if (!activeMention) return [];
        const query = activeMention.query.trim();
        const filtered = mentionCandidates.filter((candidate) => {
            if (!query) return true;
            return (
                candidate.localpart.toLowerCase().includes(query) ||
                candidate.label.toLowerCase().includes(query)
            );
        });
        return filtered.slice(0, 6);
    }, [activeMention, mentionCandidates]);
    useEffect(() => {
        if (!activeMention) return;
        if (visibleMentionCandidates.length === 0) {
            setActiveMention(null);
            return;
        }
        setActiveMentionIndex((prev) => Math.min(prev, visibleMentionCandidates.length - 1));
    }, [activeMention, visibleMentionCandidates]);
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
        if (!showInviteMembersModal || !canManageRoom) return;
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
    }, [showInviteMembersModal, canManageRoom, inviteAccessToken, inviteHsUrl, pushToast, t]);

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
        const timer = window.setTimeout(() => {
            setDebouncedRoomSearchQuery(roomSearchQuery.trim());
        }, ROOM_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [roomSearchQuery]);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent): void => {
            const target = event.target as Node;
            if (roomSearchPanelRef.current?.contains(target) || roomSearchButtonRef.current?.contains(target)) return;
            setShowRoomSearchPanel(false);
        };
        if (showRoomSearchPanel) {
            document.addEventListener("click", onClickOutside);
        }
        return () => {
            document.removeEventListener("click", onClickOutside);
        };
    }, [showRoomSearchPanel]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
                event.preventDefault();
                setShowRoomSearchPanel(true);
            }
            if (event.key === "Escape") {
                setShowRoomSearchPanel(false);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    const formatDateTimeInputToIso = useCallback((value: string): string | undefined => {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const date = new Date(trimmed);
        if (Number.isNaN(date.getTime())) return undefined;
        return date.toISOString();
    }, []);

    const runRoomSearch = useCallback(async (params?: { forceQuery?: string; cursor?: string; append?: boolean }) => {
        if (!showRoomSearchPanel || !activeRoomId) return;
        if (!hubAccessToken || !matrixAccessToken || !matrixHsUrl || !matrixCredentials?.user_id) {
            setRoomSearchError("NO_VALID_HUB_TOKEN：請重新登入後再使用房內搜尋");
            return;
        }
        const effectiveQuery = (params?.forceQuery ?? debouncedRoomSearchQuery).trim();
        if (roomSearchType === "messages" && !effectiveQuery) {
            setRoomSearchResult({
                room_id: activeRoomId,
                message_hits: [],
                file_hits: [],
                next_cursor: null,
            });
            setRoomSearchCursor(null);
            setRoomSearchError(null);
            setRoomSearchLoading(false);
            return;
        }
        setRoomSearchLoading(true);
        setRoomSearchError(null);
        try {
            const response = await chatSearchRoom({
                accessToken: hubAccessToken,
                matrixAccessToken,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials.user_id,
            }, {
                roomId: activeRoomId,
                q: effectiveQuery,
                type: roomSearchType,
                fromTs: formatDateTimeInputToIso(roomSearchFrom),
                toTs: formatDateTimeInputToIso(roomSearchTo),
                limit: 20,
                cursor: params?.cursor,
            });
            if (params?.append) {
                setRoomSearchResult((prev) => {
                    if (!prev) return response;
                    return {
                        ...response,
                        message_hits: [...prev.message_hits, ...response.message_hits],
                        file_hits: [...prev.file_hits, ...response.file_hits],
                    };
                });
            } else {
                setRoomSearchResult(response);
            }
            setRoomSearchCursor(response.next_cursor ?? null);
        } catch (error) {
            if (error instanceof ChatSearchError) {
                if (error.status === 401) {
                    setRoomSearchError("401：房內搜尋驗證失敗，請重新登入");
                } else if (error.status === 403) {
                    setRoomSearchError("403：你沒有此聊天室的搜尋權限");
                } else {
                    setRoomSearchError(error.message || "房內搜尋失敗");
                }
            } else {
                setRoomSearchError(error instanceof Error ? error.message : "房內搜尋失敗");
            }
        } finally {
            setRoomSearchLoading(false);
        }
    }, [activeRoomId, debouncedRoomSearchQuery, formatDateTimeInputToIso, hubAccessToken, matrixAccessToken, matrixCredentials?.user_id, matrixHsUrl, roomSearchFrom, roomSearchTo, roomSearchType, showRoomSearchPanel]);

    useEffect(() => {
        if (!showRoomSearchPanel || !activeRoomId) return;
        const q = debouncedRoomSearchQuery.trim();
        if (roomSearchType === "messages" && !q) {
            setRoomSearchResult({
                room_id: activeRoomId,
                message_hits: [],
                file_hits: [],
                next_cursor: null,
            });
            setRoomSearchCursor(null);
            setRoomSearchError(null);
            setRoomSearchLoading(false);
            return;
        }
        void runRoomSearch();
    }, [activeRoomId, debouncedRoomSearchQuery, roomSearchType, roomSearchFrom, roomSearchTo, showRoomSearchPanel, runRoomSearch]);

    const revealEventInTimeline = useCallback(async (eventId: string): Promise<boolean> => {
        const container = timelineRef.current;
        if (!container) return false;
        const escapedEventId = eventId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const findTarget = (): HTMLElement | null =>
            container.querySelector(`[data-event-id="${escapedEventId}"]`) as HTMLElement | null;
        let target = findTarget();
        let rounds = 0;
        while (!target && matrixClient && room && rounds < 8) {
            await scrollbackTimeline(matrixClient, room, 60);
            // allow timeline render to flush
            await new Promise((resolve) => window.setTimeout(resolve, 80));
            target = findTarget();
            rounds += 1;
        }
        if (!target) return false;
        if (activeRoomId) {
            roomStickBottomRef.current[activeRoomId] = false;
        }
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedEventId(eventId);
        window.setTimeout(() => {
            setHighlightedEventId((prev) => (prev === eventId ? null : prev));
        }, 1800);
        return true;
    }, [activeRoomId, matrixClient, room]);

    const onLocateSearchEvent = useCallback(async (eventId: string): Promise<void> => {
        if (!activeRoomId || !hubAccessToken || !matrixAccessToken || !matrixHsUrl || !matrixCredentials?.user_id) {
            setRoomSearchError("NO_VALID_HUB_TOKEN：請重新登入後再使用定位");
            return;
        }
        try {
            const locate = await chatSearchLocate({
                accessToken: hubAccessToken,
                matrixAccessToken,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials.user_id,
            }, {
                roomId: activeRoomId,
                eventId,
                contextBefore: 5,
                contextAfter: 5,
            });
            const anchorEventId = locate.anchor_event?.event_id || eventId;
            const ok = await revealEventInTimeline(anchorEventId);
            if (!ok) {
                setRoomSearchError("定位失敗：未在目前可讀取的歷史中找到該訊息");
            }
        } catch (error) {
            if (error instanceof ChatSearchError) {
                if (error.status === 401) {
                    setRoomSearchError("401：定位驗證失敗，請重新登入");
                } else if (error.status === 403) {
                    setRoomSearchError("403：你沒有此聊天室定位權限");
                } else {
                    setRoomSearchError(error.message || "定位失敗");
                }
            } else {
                setRoomSearchError(error instanceof Error ? error.message : "定位失敗");
            }
        }
    }, [activeRoomId, hubAccessToken, matrixAccessToken, matrixCredentials?.user_id, matrixHsUrl, revealEventInTimeline]);

    useEffect(() => {
        if (!jumpToEventId) return;
        let cancelled = false;
        void (async (): Promise<void> => {
            const ok = await revealEventInTimeline(jumpToEventId);
            if (cancelled) return;
            if (!ok) {
                setUploadError("目標訊息定位失敗，請稍後再試");
            }
            onJumpHandled?.();
        })();
        return () => {
            cancelled = true;
        };
    }, [jumpToEventId, onJumpHandled, revealEventInTimeline]);

    useEffect(() => {
        const prevRoomId = previousRoomIdRef.current;
        const container = timelineRef.current;
        if (prevRoomId && container) {
            const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
            roomStickBottomRef.current[prevRoomId] = distance < 120;
        }
        previousRoomIdRef.current = activeRoomId;
        if (!activeRoomId || jumpToEventId) return;
        if (suppressAutoStickBottomRef.current) return;
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

    useLayoutEffect(() => {
        const anchor = historyScrollAnchorRef.current;
        const container = timelineRef.current;
        if (!anchor || !container || !activeRoomId || anchor.roomId !== activeRoomId) return;
        if (mergedEvents.length <= anchor.previousEventCount) return;
        const delta = container.scrollHeight - anchor.previousScrollHeight;
        container.scrollTop = anchor.previousScrollTop + delta;
        historyScrollAnchorRef.current = null;
        suppressAutoStickBottomRef.current = false;
    }, [activeRoomId, mergedEvents.length]);

    // 自動滾動到底部並發送已讀回執
    useEffect(() => {
        if (!room || !matrixClient) return;
        const container = timelineRef.current;
        if (!container) return;
        if (suppressAutoStickBottomRef.current) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        const shouldStickBottom = activeRoomId ? (roomStickBottomRef.current[activeRoomId] ?? true) : false;
        if (shouldStickBottom || distanceFromBottom < 120) {
            if (activeRoomId) roomStickBottomRef.current[activeRoomId] = true;
            container.scrollTop = container.scrollHeight;
            // 在底部時發送已讀回執
            const latestEvent = mergedEvents[mergedEvents.length - 1];
            sendReadReceiptIfNeeded(latestEvent);
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
                sendReadReceiptIfNeeded(latestEvent);
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
            sendReadReceiptIfNeeded(latestEvent);
        }

        // 滾動加載更多消息
        if (container.scrollTop > 0) return;
        const activeRoom = activeRoomId;
        const anchor = activeRoom
            ? {
                roomId: activeRoom,
                previousScrollHeight: container.scrollHeight,
                previousScrollTop: container.scrollTop,
                previousEventCount: mergedEvents.length,
            }
            : null;
        setScrollLoading(true);
        if (activeRoom) {
            roomStickBottomRef.current[activeRoom] = false;
        }
        if (anchor) {
            historyScrollAnchorRef.current = anchor;
            suppressAutoStickBottomRef.current = true;
        }
        try {
            await scrollbackTimeline(matrixClient, room, 30);
        } finally {
            window.setTimeout(() => {
                if (historyScrollAnchorRef.current === anchor) {
                    historyScrollAnchorRef.current = null;
                    suppressAutoStickBottomRef.current = false;
                }
                setScrollLoading(false);
            }, 120);
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
        if (isDirectPeerAbsent) {
            pushToast("warn", t("chat.directPeerLeftNotice"));
            return;
        }
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
        const finalText = trimmed && quotedMessage ? buildQuotedMessageBody(quotedMessage, trimmed) : trimmed;
        const mentionedUserIds = mentionCandidates
            .filter((candidate) => new RegExp(`(^|\\s)@${escapeRegExp(candidate.localpart)}(?=\\s|$)`, "i").test(finalText))
            .map((candidate) => candidate.userId);
        const mentionContent =
            mentionedUserIds.length > 0
                ? {
                    "m.mentions": {
                        user_ids: mentionedUserIds,
                    },
                }
                : undefined;
        if (activeRoomId) roomStickBottomRef.current[activeRoomId] = true;
        stopTypingNotice(activeRoomId);
        setComposerText("");
        setQuotedMessage(null);
        setActiveMention(null);
        setUploadError(null);
        let sentEventId: string | undefined;
        if (finalText) sentEventId = await sendTextMessage(matrixClient, activeRoomId, finalText, mentionContent);
        const peerLang = (directPeerContact?.translation_locale || directPeerContact?.locale || "").trim();
        const shouldPretranslateForClient =
            userType === "staff" &&
            isDirectRoom &&
            directPeerContact?.user_type === "client" &&
            Boolean(translateAccessToken && peerLang && sentEventId);
        pretranslateDirectToClient({
            enabled: shouldPretranslateForClient,
            text: finalText,
            messageId: sentEventId,
            roomId: activeRoomId,
            peerLanguage: peerLang,
            translate: {
                accessToken: translateAccessToken,
                sourceLang: chatReceiveLanguage,
                sourceMatrixUserId: userId,
                hsUrl: translateHsUrl,
                matrixUserId: translateMatrixUserId,
            },
        });
        const shouldPretranslateForRoomClients =
            userType === "staff" &&
            isMultiMemberRoom &&
            translationContactsLoaded &&
            Boolean(translateAccessToken && sentEventId);
        pretranslateRoomToClients({
            enabled: shouldPretranslateForRoomClients,
            text: finalText,
            messageId: sentEventId,
            roomId: activeRoomId,
            memberIds: joinedMembers.map((member) => member.userId),
            selfUserId: userId,
            resolveContactByMatrixUserId,
            translate: {
                accessToken: translateAccessToken,
                sourceLang: chatReceiveLanguage,
                sourceMatrixUserId: userId,
                hsUrl: translateHsUrl,
                matrixUserId: translateMatrixUserId,
            },
        });
        await sendReadyAttachments(
            matrixClient,
            activeRoomId,
            readyAttachments.map((item) => ({ ...item, mxcUrl: item.mxcUrl! })) as ReadyAttachment[],
        );
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

    useEffect(() => {
        setQuotedMessage(null);
    }, [activeRoomId]);

    const sendMessageFileToNotebook = async (event: MatrixEvent): Promise<void> => {
        if (!notebookAuth || !canUseNotebookBasic) return;
        const content = event.getContent() as { body?: string; msgtype?: string; info?: { mimetype?: string; size?: number }; url?: string } | undefined;
        const mxc = String(content?.url || "");
        if (!mxc.startsWith("mxc://")) {
            pushToast("error", t("chat.notebook.errors.invalidMxc"));
            return;
        }
        const eventId = event.getId() || "";
        setSendingFileToNotebookEventId(eventId || "busy");
        try {
            const fileName = (content?.body || "").trim() || t("chat.notebook.importedAttachmentFallbackName");
            const created = await notebookAdapter.createItem(notebookAuth, {
                title: fileName,
                contentMarkdown: t("chat.notebook.importedFromChat"),
                isIndexable: true,
                itemType: "file",
            });
            await notebookAdapter.attachFile(notebookAuth, created.id, {
                matrixMediaMxc: mxc,
                matrixMediaName: fileName,
                matrixMediaMime: content?.info?.mimetype,
                matrixMediaSize: content?.info?.size,
                isIndexable: true,
            });
            pushToast("success", t("chat.notebook.sendFileToKnowledgeBaseSuccess"));
        } catch (error) {
            const message = mapNotebookErrorToMessage(error, t);
            pushToast("error", message);
        } finally {
            setSendingFileToNotebookEventId(null);
        }
    };

    const copyMessageContent = async (event: MatrixEvent, displayText: string): Promise<void> => {
        const content = event.getContent() as { body?: string; url?: string } | undefined;
        const parts = [
            (displayText || "").trim(),
            String(content?.body || "").trim(),
            String(content?.url || "").trim(),
        ].filter(Boolean);
        const unique = Array.from(new Set(parts));
        const payload = unique.join("\n");
        if (!payload) return;
        try {
            await navigator.clipboard.writeText(payload);
            pushToast("success", t("chat.copyMessageSuccess"));
        } catch {
            pushToast("error", t("chat.copyMessageFailed"));
        }
    };

    const quoteMessage = (event: MatrixEvent): void => {
        const sender = event.getSender();
        const senderMember = sender ? room?.getMember(sender) : null;
        const senderLabel = getUserLabel(sender, senderMember?.name);
        const preview = getQuotedMessagePreview(event);
        if (!preview) return;
        setQuotedMessage({
            senderLabel,
            preview,
        });
        composerRef.current?.focus();
    };

    const onRegenerateAssist = async (): Promise<void> => {
        if (!lastAssistTrigger) return;
        if (lastAssistTrigger.type === "query") {
            await runAssistQuery(lastAssistTrigger.query);
            return;
        }
        await runAssistFromContext(lastAssistTrigger.anchorEventId);
    };

    const onDirectSendAssist = async (): Promise<void> => {
        if (!matrixClient || !activeRoomId || isDeprecatedRoom) return;
        const finalText = assistReferenceAnswer || assistSummaryText || (assistOutput?.answer || "").trim();
        if (!finalText || assistLowConfidence) return;
        setAssistSending(true);
        try {
            await sendTextMessage(matrixClient, activeRoomId, finalText);
            resetAssist();
        } finally {
            setAssistSending(false);
        }
    };

    const onResend = async (event: MatrixEvent): Promise<void> => {
        if (!matrixClient || !room) return;
        await resendMessageEvent(matrixClient, event, room);
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
            await redactMessageEvent(matrixClient, activeRoomId, eventId);
            const content = event.getContent() as { url?: string } | undefined;
            if (content?.url && matrixCredentials?.hs_url && matrixCredentials?.access_token) {
                await cleanupUploadedMedia(matrixCredentials.hs_url, matrixCredentials.access_token, content.url);
                removeDraftMediaEntries([content.url]);
            }
            const selfLabel = getLocalPart(userId) || userId;
            await sendNoticeMessageEvent(matrixClient, activeRoomId, t("chat.fileRevokedNotice", { name: selfLabel }));
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

    const onRecallMessageEvent = async (event: MatrixEvent): Promise<void> => {
        const eventId = event.getId();
        if (!matrixClient || !activeRoomId || !eventId || !userId) return;
        const content = event.getContent() as { msgtype?: string } | undefined;
        const isRecallableMessage = event.getType() === EventType.RoomMessage
            && content?.msgtype !== MsgType.Notice;
        if (event.getSender() !== userId || !isRecallableMessage) return;
        try {
            await redactMessageEvent(matrixClient, activeRoomId, eventId);
            pushToast("success", t("chat.recallMessageSuccess"));
        } catch (error) {
            const message = mapActionErrorToMessage(t, error, "chat.recallMessageFailed");
            pushToast("error", message || t("chat.recallMessageFailed"));
        }
    };

    const otherMember = room
        ? room.getJoinedMembers().find((member) => member.userId !== userId)
        : undefined;
    const headerName = room?.name || getUserLabel(otherMember?.userId, otherMember?.name) || t("chat.headerFallback");
    const roomName = room?.name || t("chat.roomNameFallback", t("chat.groupNameFallback"));
    const roomDisplayName = room?.name || headerName || t("chat.headerFallback");
    const memberEntries = useMemo(() => {
        const defaultLevel = powerLevels?.users_default ?? 0;
        return joinedMembers
            .map((member) => ({
                userId: member.userId,
                name: member.name || member.userId,
                powerLevel: powerLevels?.users?.[member.userId] ?? defaultLevel,
            }))
            .sort((a, b) => {
                if (a.powerLevel !== b.powerLevel) return b.powerLevel - a.powerLevel;
                return a.name.localeCompare(b.name);
            });
    }, [joinedMembers, powerLevels]);
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
        if (isDirectPeerAbsent) {
            pushToast("warn", t("chat.directPeerLeftNotice"));
            return;
        }
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

    const uploadDraftAttachment = async (
        file: File,
        explicitRoomId?: string,
        metadata?: { durationMs?: number },
    ): Promise<void> => {
        const roomId = explicitRoomId ?? activeRoomId;
        if (!matrixClient || !roomId || isDeprecatedRoom) return;
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
                    durationMs: metadata?.durationMs,
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

    const syncMentionState = (nextText: string, explicitCursor?: number): void => {
        const input = composerRef.current;
        const cursor = explicitCursor ?? input?.selectionStart ?? nextText.length;
        const nextMention = extractActiveMention(nextText, cursor);
        setActiveMention(nextMention);
        setActiveMentionIndex(0);
    };

    const insertMentionToComposer = (candidate: MentionCandidate): void => {
        const input = composerRef.current;
        const currentMention = activeMention ?? extractActiveMention(composerText, input?.selectionStart ?? composerText.length);
        if (!currentMention) return;
        const mentionText = `@${candidate.localpart} `;
        const nextText = `${composerText.slice(0, currentMention.start)}${mentionText}${composerText.slice(currentMention.end)}`;
        const nextCursor = currentMention.start + mentionText.length;
        setComposerText(nextText);
        setActiveMention(null);
        requestAnimationFrame(() => {
            const target = composerRef.current;
            if (!target) return;
            target.focus();
            target.setSelectionRange(nextCursor, nextCursor);
            syncMentionState(nextText, nextCursor);
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

    useEffect(() => {
        setShowTaskQuickCreate(false);
        setExpandedTaskIds([]);
    }, [activeRoomId]);

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
                    {isMultiMemberRoom ? (
                        <>
                            <div className="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-700 dark:text-emerald-300 text-sm font-semibold">
                                {roomName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex flex-col">
                                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                                    {roomName}
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
                        <>
                            <div className="flex flex-col">
                                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{headerName}</h2>
                                <span className="text-xs text-green-600 flex items-center gap-1 dark:text-emerald-400">
                                    <span className="w-2 h-2 bg-green-500 rounded-full dark:bg-emerald-400"></span>
                                    {t("common.online")}
                                </span>
                            </div>
                            {canManageRoom && (
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
                            )}
                        </>
                    )}
                </div>

                <div className="flex items-center gap-4 text-gray-500 dark:text-slate-400">
                    <button
                        ref={roomSearchButtonRef}
                        type="button"
                        onClick={() => setShowRoomSearchPanel((prev) => !prev)}
                        className={`transition-colors p-2 rounded-full hover:bg-gray-50 dark:hover:bg-slate-800 ${showRoomSearchPanel ? "text-[#2F5C56] dark:text-emerald-300" : "hover:text-[#2F5C56]"}`}
                    >
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
                                {canManageInvites && !isDeprecatedRoom && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isDeprecatedRoom) return;
                                            setShowActionsMenu(false);
                                            setShowInviteSettingsModal(true);
                                            setInviteError(null);
                                        }}
                                        className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                    >
                                        {t("chat.inviteSettings")}
                                    </button>
                                )}
                                {canInviteMembers && !isDeprecatedRoom && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isDeprecatedRoom) return;
                                            setShowActionsMenu(false);
                                            setShowInviteMembersModal(true);
                                            setInviteMemberError(null);
                                        }}
                                        className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                    >
                                        {t("chat.inviteMembers")}
                                    </button>
                                )}
                                {canRenameRoom && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowActionsMenu(false);
                                            setRenameValue(roomDisplayName);
                                            setShowRenameModal(true);
                                            setRenameError(null);
                                        }}
                                        className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                                    >
                                        {t("chat.renameRoom", "Rename room")}
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
                                {canLeaveRoom ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowActionsMenu(false);
                                            setShowLeaveConfirm(true);
                                        }}
                                        className="w-full px-3 py-2 text-left text-rose-500 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-slate-800"
                                    >
                                        {t("chat.leaveRoom", "Leave room")}
                                    </button>
                                ) : null}
                                {isDirectRoom && (
                                    <>
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

            {showRoomSearchPanel && (
                <div ref={roomSearchPanelRef} className="border-b border-emerald-200 bg-emerald-50/60 px-4 py-3 text-xs dark:border-emerald-900/50 dark:bg-emerald-900/20">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        <input
                            type="text"
                            value={roomSearchQuery}
                            onChange={(event) => setRoomSearchQuery(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    void runRoomSearch({ forceQuery: roomSearchQuery });
                                }
                            }}
                            placeholder="搜尋此聊天室（訊息/檔案）"
                            className="min-w-[220px] flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <select
                            value={roomSearchType}
                            onChange={(event) => setRoomSearchType(event.target.value as "all" | "messages" | "files")}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                            <option value="all">全部</option>
                            <option value="messages">消息</option>
                            <option value="files">文件</option>
                        </select>
                        <input
                            type="datetime-local"
                            value={roomSearchFrom}
                            onChange={(event) => setRoomSearchFrom(event.target.value)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <input
                            type="datetime-local"
                            value={roomSearchTo}
                            onChange={(event) => setRoomSearchTo(event.target.value)}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <button
                            type="button"
                            onClick={() => void runRoomSearch({ forceQuery: roomSearchQuery })}
                            className="rounded-md bg-[#2F5C56] px-3 py-1.5 font-semibold text-white"
                        >
                            搜尋
                        </button>
                    </div>
                    {roomSearchLoading && <div className="text-slate-500 dark:text-slate-300">搜尋中...</div>}
                    {roomSearchError && <div className="text-rose-600 dark:text-rose-300">{roomSearchError}</div>}
                    {!roomSearchLoading && !roomSearchError && roomSearchResult && (
                        <div className="space-y-2">
                            {roomSearchResult.message_hits.length > 0 && (
                                <div>
                                    <div className="mb-1 font-semibold text-slate-500 dark:text-slate-300">消息結果</div>
                                    <div className="space-y-1">
                                        {roomSearchResult.message_hits.map((hit: ChatSearchMessageHit) => (
                                            <button
                                                key={`${hit.room_id}-${hit.event_id}`}
                                                type="button"
                                                onClick={() => {
                                                    void onLocateSearchEvent(hit.event_id);
                                                }}
                                                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-left hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                                            >
                                                <div className="line-clamp-2 text-slate-700 dark:text-slate-100">{hit.preview || "(no preview)"}</div>
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                                    {`${formatMatrixUserLocalId(hit.sender) || ""}${hit.ts ? ` · ${new Date(hit.ts).toLocaleString()}` : ""}`}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {roomSearchResult.file_hits.length > 0 && (
                                <div>
                                    <div className="mb-1 font-semibold text-slate-500 dark:text-slate-300">文件結果</div>
                                    <div className="space-y-1">
                                        {roomSearchResult.file_hits.map((hit: ChatSearchFileHit) => (
                                            <button
                                                key={`${hit.room_id}-${hit.event_id}-file`}
                                                type="button"
                                                onClick={() => {
                                                    void onLocateSearchEvent(hit.event_id);
                                                }}
                                                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-left hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                                            >
                                                <div className="text-slate-700 dark:text-slate-100">{hit.file_name || "unnamed file"}</div>
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400">{`${hit.mime || ""}${typeof hit.size === "number" ? ` · ${hit.size} bytes` : ""}${hit.ts ? ` · ${new Date(hit.ts).toLocaleString()}` : ""}`}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {roomSearchResult.message_hits.length === 0 && roomSearchResult.file_hits.length === 0 && (
                                <div className="text-slate-500 dark:text-slate-300">沒有搜尋結果</div>
                            )}
                            {roomSearchCursor && (
                                <button
                                    type="button"
                                    onClick={() => void runRoomSearch({ forceQuery: roomSearchQuery, cursor: roomSearchCursor, append: true })}
                                    className="rounded-md border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                >
                                    載入更多
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {taskStatuses && roomTasks && roomTasks.length > 0 && (
                <div className="border-b border-slate-200 bg-white/70 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/60">
                    <TaskRoomBar
                        tasks={roomTasks}
                        statuses={taskStatuses}
                        expandedTaskIds={expandedTaskIds}
                        onStatusChange={onUpdateRoomTaskStatus}
                        onOpenTaskList={onOpenTasksTab}
                        onToggle={(taskId) =>
                            setExpandedTaskIds((prev) =>
                                prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
                            )
                        }
                    />
                </div>
            )}

            {/* Chat History (Timeline) */}
            <div
                ref={timelineRef}
                data-testid="chat-timeline"
                onScroll={() => void onScroll()}
                className="flex-1 min-h-0 overflow-y-auto p-6 bg-[#F2F4F7] dark:bg-slate-950"
            >
                {showingCachedEvents && (
                    <div className="mb-4 rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-4 py-2 text-xs text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {t("chat.syncingLatestMessages")}
                    </div>
                )}
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
                        if (!room || room.isSpaceRoom()) return null;
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
                    const senderAvatarMxc = senderMember?.user?.avatarUrl ?? null;
                    const senderAvatarUrl = senderAvatarMxc && matrixClient
                        ? matrixClient.mxcUrlToHttp(senderAvatarMxc, 48, 48, "crop") ?? matrixClient.mxcUrlToHttp(senderAvatarMxc) ?? null
                        : null;
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
                                senderAvatarUrl={senderAvatarUrl}
                                onOpenMedia={openMediaPreview}
                                translatedText={translationMap[getMessageEventKey(event)]?.text ?? null}
                                translationMode={translationView[getMessageEventKey(event)] ?? (!isMe ? (translationDefaultView ?? "translated") : "original")}
                                translationLoading={translationMap[getMessageEventKey(event)]?.loading ?? false}
                                translationError={translationMap[getMessageEventKey(event)]?.error ?? false}
                                translationSuspect={translationMap[getMessageEventKey(event)]?.suspect ?? false}
                                allowTranslationActions={!isDirectRoom || directTranslationEnabled}
                                canDeleteFile={isOwnFileEvent(event)}
                                deleteBusy={deletingEventId === event.getId()}
                                onDeleteFile={(targetEvent) => {
                                    void onDeleteFileEvent(targetEvent);
                                }}
                                canUseNotebookAssist={canUseNotebookAssist}
                                onAssistFromContext={(anchorId) => {
                                    void runAssistFromContext(anchorId);
                                }}
                                canUseNotebookBasic={canUseNotebookBasic}
                                onSendFileToNotebook={(targetEvent) => {
                                    void sendMessageFileToNotebook(targetEvent);
                                }}
                                sendFileToNotebookBusy={Boolean(sendingFileToNotebookEventId && sendingFileToNotebookEventId === eventId)}
                                onCopyMessage={(targetEvent, text) => {
                                    void copyMessageContent(targetEvent, text);
                                }}
                                onQuoteMessage={(targetEvent) => {
                                    quoteMessage(targetEvent);
                                }}
                                onRecallMessage={(targetEvent) => {
                                    void onRecallMessageEvent(targetEvent);
                                }}
                                onSetTranslationMode={(mode) => {
                                    const key = getMessageEventKey(event);
                                    setTranslationView((prev) => ({ ...prev, [key]: mode }));
                                    if (mode === "translated" || mode === "bilingual") {
                                        const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
                                        const messageText = content?.body ?? "";
                                        const cache = translationMap[key];
                                        const hasCachedTranslation = Boolean((cache?.text ?? "").trim());
                                        const shouldLoad =
                                            !cache || (!cache.loading && !hasCachedTranslation && !cache.error);
                                        if (messageText && shouldLoad) {
                                            void requestTranslation(event, messageText);
                                        }
                                    }
                                }}
                                onRetryTranslation={() => {
                                    const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
                                    const messageText = content?.body ?? "";
                                    if (messageText) {
                                        void requestTranslation(event, messageText, true);
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
                {isDirectPeerAbsent && (
                    <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                        {t("chat.directPeerLeftNotice")}
                    </div>
                )}
                {isSoloInRoom && (
                    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                        {t("chat.singleMemberNotice", "此房间就剩你一人，发的讯息都是在和空气聊天哦")}
                    </div>
                )}
                {notebookCapabilityError && (
                    <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                        <div>{notebookCapabilityError}</div>
                        <div className="mt-2 flex gap-2">
                            <button
                                type="button"
                                onClick={() => onRetryNotebookCapability?.()}
                                className="rounded-md border border-rose-300 px-2 py-1 font-semibold hover:bg-rose-100 dark:border-rose-700 dark:hover:bg-rose-900/40"
                            >
                                {t("chat.notebook.retry")}
                            </button>
                            <button
                                type="button"
                                onClick={() => onReloginForNotebook?.()}
                                className="rounded-md bg-rose-600 px-2 py-1 font-semibold text-white hover:bg-rose-700"
                            >
                                {t("chat.notebook.relogin")}
                            </button>
                            {!hasNotebookAuthToken && (
                                <span className="self-center text-[11px] opacity-90">{t("chat.notebook.noValidHubTokenHint")}</span>
                            )}
                        </div>
                    </div>
                )}
                {typingMemberLabels.length > 0 && (
                    <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <TranslationTypingIndicator isMe={false} />
                        <span className="truncate">
                            {formatTypingIndicatorLabel(typingMemberLabels, t)}
                        </span>
                    </div>
                )}
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
                        disabled={isDeprecatedRoom || isDirectPeerAbsent}
                    >
                        <PaperClipIcon className="w-6 h-6" />
                    </button>
                    {taskStatuses && taskQuickDraft && onTaskQuickDraftChange && onCreateRoomTask && (
                        <button
                            type="button"
                            onClick={() => setShowTaskQuickCreate((prev) => !prev)}
                            className={`hover:text-[#2F5C56] dark:hover:text-emerald-400 ${showTaskQuickCreate ? "text-[#2F5C56] dark:text-emerald-400" : ""}`}
                            title={t("tasks.title")}
                        >
                            <ClockIcon className="w-6 h-6" />
                        </button>
                    )}
                    {canUseNotebookAssist && (
                        <button
                            type="button"
                            onClick={() => {
                                void runAssistQuery(composerText);
                            }}
                            className="hover:text-[#2F5C56] dark:hover:text-emerald-400"
                            title={t("chat.notebook.panelTitle")}
                        >
                            <SparklesIcon className="w-6 h-6" />
                        </button>
                    )}
                </div>

                {taskStatuses && taskQuickDraft && onTaskQuickDraftChange && onCreateRoomTask && (
                    <div className="mb-3">
                        <TaskQuickCreate
                            open={showTaskQuickCreate}
                            draft={taskQuickDraft}
                            statuses={taskStatuses}
                            onDraftChange={onTaskQuickDraftChange}
                            onSave={() => {
                                onCreateRoomTask();
                                setShowTaskQuickCreate(false);
                            }}
                            onClose={() => setShowTaskQuickCreate(false)}
                        />
                    </div>
                )}

                {(assistState !== "idle" || assistOutput || assistError) && (
                    <div className={`${assistEditorFullscreen
                        ? "fixed inset-2 z-50 mb-0 overflow-y-auto rounded-xl border border-emerald-300 bg-emerald-50 p-3 shadow-2xl dark:border-emerald-800 dark:bg-slate-900"
                        : "mb-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-900/20"
                        }`}>
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
                                {t("chat.notebook.panelTitle")}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setAssistEditorRows((prev) => Math.max(4, prev - 2))}
                                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                >
                                    -
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAssistEditorRows((prev) => Math.min(18, prev + 2))}
                                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                >
                                    +
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAssistEditorFullscreen((prev) => !prev)}
                                    className="rounded border border-slate-300 p-1 text-slate-500 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                    aria-label={assistEditorFullscreen ? "collapse ai panel" : "expand ai panel"}
                                >
                                    {assistEditorFullscreen ? <ArrowsPointingInIcon className="h-3.5 w-3.5" /> : <ArrowsPointingOutIcon className="h-3.5 w-3.5" />}
                                </button>
                                <button
                                    type="button"
                                    onClick={resetAssist}
                                    className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                >
                                    {t("chat.notebook.close")}
                                </button>
                            </div>
                        </div>
                        {assistState === "loading" && (
                            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("chat.notebook.generating")}</div>
                        )}
                        {assistError && (
                            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                                {assistError}
                            </div>
                        )}
                        {assistOutput && (
                            <div className="mt-2 space-y-2">
                                <textarea
                                    value={assistSummaryText}
                                    onChange={(event) => setAssistDraft(event.target.value)}
                                    rows={assistEditorFullscreen ? 16 : assistEditorRows}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                                <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm dark:border-emerald-900/40 dark:bg-slate-900">
                                    <div className="mb-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">參考答案</div>
                                    <div className="text-slate-700 dark:text-slate-100">{assistReferenceAnswer || "（尚未生成）"}</div>
                                </div>
                                {assistLowConfidence && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/30 dark:text-amber-200">
                                        {t("chat.notebook.lowConfidenceWarning")}
                                    </div>
                                )}
                                {!assistOutput.citations.length && (
                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                        {t("chat.notebook.noEvidenceWarning")}
                                    </div>
                                )}
                                <div>
                                    <button
                                        type="button"
                                        onClick={() => setAssistCitationsExpanded((prev) => !prev)}
                                        className="text-xs font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                                    >
                                        {assistCitationsExpanded ? t("chat.notebook.hideCitations") : t("chat.notebook.showCitations")}
                                    </button>
                                    {assistCitationsExpanded && (
                                        <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                                            {assistOutput.citations.length === 0 ? (
                                                <div>{t("chat.notebook.noCitations")}</div>
                                            ) : assistOutput.citations.map((citation, idx) => (
                                                <div key={`${citation.sourceId}-${idx}`} className="rounded-md border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                                                    {(() => {
                                                        const linked = assistSourceMap.get(citation.sourceId)
                                                            || assistSourceMap.get(citation.sourceId.split(":")[0] || citation.sourceId);
                                                        const title = normalizeSourceTitle(linked?.title || citation.title, citation.sourceId);
                                                        const snippet = (linked?.snippet || "").trim();
                                                        const scope = citation.sourceScope || linked?.sourceScope || "personal";
                                                        const fileName = citation.sourceFileName || linked?.sourceFileName || null;
                                                        const sourceTag = scope === "company" ? "公司知識庫" : "個人知識";
                                                        return (
                                                            <div className="space-y-1">
                                                                <div className="font-semibold text-slate-700 dark:text-slate-100">
                                                                    {`[${title}|S${idx + 1}]`}
                                                                    {snippet ? `明確指出：${snippet}` : ""}
                                                                </div>
                                                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                                                    {`${sourceTag}${fileName ? ` · ${fileName}` : ""}${citation.locator ? ` · ${citation.locator}` : ""} · #${idx + 1}`}
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setComposerText(assistSummaryText)}
                                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                                    >
                                        {t("chat.notebook.applyToInput")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void onDirectSendAssist();
                                        }}
                                        disabled={assistLowConfidence || assistSending || assistReferenceAnswer.length === 0}
                                        className="rounded-lg bg-[#2F5C56] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {assistSending ? t("chat.notebook.sending") : "發送參考答案"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void onRegenerateAssist();
                                        }}
                                        disabled={assistState === "loading" || !lastAssistTrigger}
                                        className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700 dark:text-emerald-300"
                                    >
                                        {t("chat.notebook.regenerate")}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

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
                    <div className="relative flex-1">
                        {quotedMessage && (
                            <div className="mb-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-slate-700 dark:text-slate-100">{quotedMessage.senderLabel}</div>
                                        <div className="whitespace-pre-wrap break-words leading-5">{quotedMessage.preview}</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setQuotedMessage(null)}
                                        className="shrink-0 rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                                        aria-label={t("chat.clearQuotedMessage")}
                                    >
                                        <XMarkIcon className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                        <textarea
                            ref={composerRef}
                            data-testid="chat-composer-input"
                            value={composerText}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                setComposerText(nextValue);
                                syncMentionState(nextValue, event.target.selectionStart ?? nextValue.length);
                            }}
                            onClick={(event) => {
                                syncMentionState(composerText, event.currentTarget.selectionStart ?? composerText.length);
                            }}
                            onKeyUp={(event) => {
                                syncMentionState(composerText, event.currentTarget.selectionStart ?? composerText.length);
                            }}
                            onKeyDown={(event) => {
                                if (activeMention && visibleMentionCandidates.length > 0) {
                                    if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        setActiveMentionIndex((prev) => (prev + 1) % visibleMentionCandidates.length);
                                        return;
                                    }
                                    if (event.key === "ArrowUp") {
                                        event.preventDefault();
                                        setActiveMentionIndex((prev) => (prev - 1 + visibleMentionCandidates.length) % visibleMentionCandidates.length);
                                        return;
                                    }
                                    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                                        event.preventDefault();
                                        insertMentionToComposer(visibleMentionCandidates[activeMentionIndex] || visibleMentionCandidates[0]);
                                        return;
                                    }
                                    if (event.key === "Escape") {
                                        event.preventDefault();
                                        setActiveMention(null);
                                        return;
                                    }
                                }
                                if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                                    event.preventDefault();
                                    void onSend();
                                }
                            }}
                            className="flex-1 w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-slate-800 leading-5 focus:outline-none focus:border-[#2F5C56] focus:ring-1 focus:ring-[#2F5C56] resize-none min-h-12 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:focus:border-emerald-400 dark:focus:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-slate-800"
                            placeholder={
                                isDeprecatedRoom
                                    ? t("chat.deprecatedPlaceholder")
                                    : isDirectPeerAbsent
                                        ? t("chat.directPeerLeftPlaceholder")
                                        : t("chat.placeholder")
                            }
                            rows={1}
                            disabled={isDeprecatedRoom || isDirectPeerAbsent}
                        />
                        {activeMention && visibleMentionCandidates.length > 0 && (
                            <div
                                ref={mentionMenuRef}
                                className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                            >
                                <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                                    {t("chat.mentionSuggestions")}
                                </div>
                                <div className="space-y-1">
                                    {visibleMentionCandidates.map((candidate, index) => (
                                        <button
                                            key={candidate.userId}
                                            type="button"
                                            onClick={() => insertMentionToComposer(candidate)}
                                            className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left ${
                                                index === activeMentionIndex
                                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
                                                    : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                                            }`}
                                        >
                                            <span className="truncate text-sm font-semibold">@{candidate.localpart}</span>
                                            <span className="truncate pl-3 text-[11px] text-slate-400 dark:text-slate-500">{candidate.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <button
                        data-testid="chat-send-button"
                        type="button"
                        onClick={() => void onSend()}
                        className="bg-[#2F5C56] hover:bg-[#244a45] text-white p-3 rounded-xl shadow-md transition-colors flex items-center justify-center dark:bg-emerald-500 dark:hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={
                            isDeprecatedRoom ||
                            isDirectPeerAbsent ||
                            (composerText.trim().length === 0 &&
                                pendingAttachments.filter((item) => item.status === "ready").length === 0)
                        }
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

            {showMembersModal && canManageRoom && (
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
                                    {t("chat.joinedMembers", "Joined Members")} ({memberCount})
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
                                                        {t("chat.roomAdminTag", t("chat.groupAdminTag"))}
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
                                    {t("chat.invitedMembers", "Invited")} ({invitedCount})
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

            {showInviteSettingsModal && canManageRoom && !isDeprecatedRoom && (
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

            {showInviteMembersModal && canManageRoom && !isDeprecatedRoom && (
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

            {showRenameModal && canManageRoom && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                                {t("chat.renameRoom", "Rename room")}
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
                            placeholder={t("chat.renameRoomPlaceholder", "Enter a new room name...")}
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
                                        setRenameError(t("chat.renameRoomRequired", "Please enter room name."));
                                        return;
                                    }
                                    const prevName = room.name || t("chat.roomNameFallback", t("chat.groupNameFallback"));
                                    const actorName = getUserLabel(userId, room.getMember(userId || "")?.name || matrixClient.getUser(userId || "")?.displayName);
                                    setRenameBusy(true);
                                    setRenameError(null);
                                    void (async () => {
                                        try {
                                            await matrixClient.setRoomName(room.roomId, nextName);
                                            await sendNoticeMessageEvent(
                                                matrixClient,
                                                room.roomId,
                                                t("chat.roomRenamedNotice", {
                                                    actor: actorName,
                                                    oldName: prevName,
                                                    newName: nextName,
                                                    defaultValue: `${actorName} renamed room from ${prevName} to ${nextName}.`,
                                                }),
                                            );
                                            setShowRenameModal(false);
                                        } catch (err) {
                                            const message = mapActionErrorToMessage(t, err, "chat.renameRoomFailed");
                                            setRenameError(message);
                                            pushToast("error", message);
                                        } finally {
                                            setRenameBusy(false);
                                        }
                                    })();
                                }}
                                className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                            >
                                {renameBusy ? t("common.loading") : t("common.confirm")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showLeaveConfirm && canLeaveRoom && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
                            {t("chat.leaveRoomConfirm", "Do you want to leave this room?")}
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
                                    if (onLeaveRoom) {
                                        onLeaveRoom();
                                    } else {
                                        onHideRoom?.();
                                    }
                                }}
                                className="flex-1 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-600"
                            >
                                {t("chat.leaveRoom", "Leave room")}
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
