import React, { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    MagnifyingGlassIcon,
    LanguageIcon,
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
    onOpenMedia: (payload: { url: string; type: "image" | "video" }) => void;
    translatedText?: string | null;
    showTranslation?: boolean;
    translationLoading?: boolean;
    translationError?: boolean;
    onToggleTranslation?: () => void;
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
}: MessageBubbleProps) => {
    const { t } = useTranslation();
    const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
    const messageText = content?.body ?? "";
    const isSending =
        status === EventStatus.SENDING || status === EventStatus.ENCRYPTING || status === EventStatus.QUEUED;
    const isFailed = status === EventStatus.NOT_SENT;
    const timeLabel = new Date(event.getTs()).toLocaleTimeString();
    const isImage = content?.msgtype === MsgType.Image && mediaUrl;
    const isVideo = content?.msgtype === MsgType.Video && mediaUrl;
    const isAudio = content?.msgtype === MsgType.Audio && mediaUrl;
    const isText = !isImage && !isVideo && !isAudio;
    const showTranslated = Boolean(isText && showTranslation);
    const displayText = showTranslated
        ? translationLoading
            ? t("chat.translationPending")
            : translationError
                ? t("chat.translationUnavailable")
                : translatedText ?? t("chat.translationUnavailable")
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
                        ) : (
                            <span className="whitespace-pre-wrap break-words">{displayText}</span>
                        )}
                    </div>

                    {/* Time (Incoming: Right of bubble) */}
                {!isMe && (
                    <span className="text-[9px] text-gray-400 self-end mb-1 dark:text-slate-500">{timeLabel}</span>
                )}
            </div>
            {isText && !isMe && onToggleTranslation && (
                <button
                    type="button"
                    className={`mt-1 text-[11px] ${isMe ? "text-emerald-100/80" : "text-emerald-600 dark:text-emerald-300"}`}
                    onClick={onToggleTranslation}
                    disabled={translationLoading}
                >
                    {translationLoading
                        ? t("chat.translationPending")
                        : showTranslated
                            ? t("chat.showOriginal")
                            : t("chat.showTranslation")}
                </button>
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
    companyName?: string | null;
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

export const ChatRoom: React.FC = () => {
    const { t } = useTranslation();
    const { activeRoomId, onMobileBack, onHideRoom, onTogglePin, isRoomPinned, chatReceiveLanguage, companyName } =
        useOutletContext<ChatRoomContext>();
    const matrixClient = useAuthStore((state) => state.matrixClient);
    const matrixCredentials = useAuthStore((state) => state.matrixCredentials);
    const userId = useAuthStore((state) => state.matrixCredentials?.user_id ?? null);
    const hubSession = useAuthStore((state) => state.hubSession);
    const userType = useAuthStore((state) => state.userType);
    const { events, room } = useRoomTimeline(matrixClient, activeRoomId, { limit: 200 });
    const timelineRef = useRef<HTMLDivElement | null>(null);
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
    const [mediaPreview, setMediaPreview] = useState<{ url: string; type: "image" | "video" } | null>(null);
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
            if (event.getType() !== EventType.RoomMessage) return false;
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
        if (!isDirectRoom || !translationContactsLoaded) return false;
        const peerHost = directPeerUserId?.split(":")[1] || null;
        const selfHost = userId?.split(":")[1] || null;
        if (userType === "client") {
            if (directPeerContact?.user_type === "staff") return true;
            if (directPeerContact?.user_type === "client") return false;
            return Boolean(peerHost && selfHost && peerHost !== selfHost);
        }
        if (userType === "staff") {
            if (directPeerContact?.user_type === "client") return true;
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
            return Boolean(peerHost && selfHost && peerHost !== selfHost);
        }
        return false;
    }, [companyName, directPeerContact, directPeerUserId, isDirectRoom, translationContactsLoaded, userId, userType]);
    const groupTranslationEnabled = useMemo(() => {
        if (!isGroupChat || !translationContactsLoaded) return false;
        return true;
    }, [isGroupChat, translationContactsLoaded]);

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
            const senderHost = senderId?.split(":")[1] || null;
            const selfHost = userId?.split(":")[1] || null;
            if (userType === "client") {
                if (senderContact?.user_type === "client") return true;
                if (senderContact?.user_type === "staff") return true;
                return Boolean(senderHost && selfHost && senderHost !== selfHost);
            }
            if (userType === "staff") {
                if (senderContact?.user_type === "client") return true;
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
                return Boolean(senderHost && selfHost && senderHost !== selfHost);
            }
            return false;
        }
        return true;
    };

    const translateEvent = async (event: MatrixEvent, messageText: string, forceRetry = false): Promise<void> => {
        if (!translateAccessToken) return;
        const messageId = event.getId();
        if (!messageId) return;
        const key = getEventKey(event);
        const senderId = event.getSender() ?? null;
        const senderContact = resolveContactByMatrixUserId(senderId);
        const senderLangHint =
            (senderContact?.translation_locale || senderContact?.locale || "").trim() || undefined;
        setTranslationMap((prev) => {
            if (prev[key]?.loading) return prev;
            if (!forceRetry && prev[key]) return prev;
            return { ...prev, [key]: { text: null, loading: true, error: false } };
        });
        try {
            const result = await hubTranslate({
                accessToken: translateAccessToken,
                text: messageText,
                targetLang: targetLanguage,
                sourceLangHint: senderLangHint,
                roomId: activeRoomId ?? undefined,
                messageId,
                sourceMatrixUserId: event.getSender() ?? undefined,
                hsUrl: translateHsUrl,
                matrixUserId: translateMatrixUserId,
            });
            setTranslationMap((prev) => ({ ...prev, [key]: { text: result.translation, loading: false, error: false } }));
            setTranslationView((prev) => (prev[key] === undefined ? { ...prev, [key]: true } : prev));
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : typeof error === "string"
                        ? error
                        : "";
            if (
                message.includes("NOT_SUBSCRIBED") ||
                message.includes("QUOTA_EXCEEDED") ||
                message.includes("CLIENT_TRANSLATION_DISABLED") ||
                message.includes("TRANSLATION_NOT_ALLOWED") ||
                message.includes("Missing chat_link_id") ||
                message.includes("Chat link not active")
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
                setContactsError(err instanceof Error ? err.message : t("chat.inviteContactsFailed"));
            })
            .finally(() => setContactsLoading(false));
    }, [showInviteMembersModal, isGroupChat, inviteAccessToken, inviteHsUrl, t]);

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
        if (!canTranslate || !translationContactsLoaded || (!isDirectRoom && !isGroupChat)) return;
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
        translationContactsLoaded,
        translationMap,
        groupTranslationEnabled,
        userId,
    ]);

    useEffect(() => {
        setTranslationMap({});
        setTranslationView({});
        setTranslationBlocked(false);
    }, [targetLanguage, activeRoomId]);

    // 自動滾動到底部並發送已讀回執
    useEffect(() => {
        if (!room || !matrixClient) return;
        const container = timelineRef.current;
        if (!container) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom < 120) {
            container.scrollTop = container.scrollHeight;
            // 在底部時發送已讀回執
            const latestEvent = mergedEvents[mergedEvents.length - 1];
            if (canSendReceipt(latestEvent)) {
                void matrixClient.sendReadReceipt(latestEvent);
            }
        }
    }, [mergedEvents.length, room, matrixClient, mergedEvents]);

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
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        }
    };

    const onSend = async (): Promise<void> => {
        if (!matrixClient || !activeRoomId || isDeprecatedRoom) return;
        const trimmed = composerText.trim();
        if (!trimmed) return;
        setComposerText("");
        const sendResult = (await matrixClient.sendEvent(activeRoomId, EventType.RoomMessage, {
            msgtype: MsgType.Text,
            body: trimmed,
        })) as { event_id?: string } | undefined;

        const sentEventId = sendResult?.event_id;
        const peerLang = (directPeerContact?.translation_locale || directPeerContact?.locale || "").trim();
        const shouldPretranslateForClient =
            userType === "staff" &&
            isDirectRoom &&
            directPeerContact?.user_type === "client" &&
            Boolean(translateAccessToken && peerLang && sentEventId);

        if (shouldPretranslateForClient && sentEventId) {
            void hubTranslate({
                accessToken: translateAccessToken as string,
                text: trimmed,
                targetLang: peerLang,
                sourceLangHint: (chatReceiveLanguage || "").trim() || undefined,
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
                void hubTranslate({
                    accessToken: translateAccessToken as string,
                    text: trimmed,
                    targetLang: lang,
                    sourceLangHint: (chatReceiveLanguage || "").trim() || undefined,
                    roomId: activeRoomId,
                    messageId: sentEventId,
                    sourceMatrixUserId: userId ?? undefined,
                    hsUrl: translateHsUrl,
                    matrixUserId: translateMatrixUserId,
                }).catch(() => undefined);
            });
        }
    };

    const onResend = async (event: MatrixEvent): Promise<void> => {
        if (!matrixClient || !room) return;
        await matrixClient.resendEvent(event, room);
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
    const openMediaPreview = (payload: { url: string; type: "image" | "video" }): void => {
        setMediaPreview(payload);
        setMediaZoom(1);
        setMediaOffset({ x: 0, y: 0 });
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
                    <button className="hover:text-[#2F5C56] transition-colors p-2 rounded-full hover:bg-gray-50 dark:hover:bg-slate-800">
                        <LanguageIcon className="w-6 h-6" />
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
                    return (
                        <MessageBubble
                            key={event.getId() ?? event.getTxnId() ?? `${event.getTs()}-${event.getSender()}`}
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
                            showTranslation={
                                translationView[getEventKey(event)] ??
                                (translationMap[getEventKey(event)]?.text ? !isMe : false)
                            }
                            onToggleTranslation={() => {
                                const key = getEventKey(event);
                                const nextValue = !(translationView[key] ?? false);
                                setTranslationView((prev) => ({ ...prev, [key]: nextValue }));
                                if (nextValue) {
                                    const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
                                    const messageText = content?.body ?? "";
                                    if (messageText) {
                                        void translateEvent(event, messageText, true);
                                    }
                                }
                            }}
                        />
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
            <div className="bg-white border-t border-gray-200 p-4 flex-shrink-0 dark:bg-slate-900 dark:border-slate-800 relative">
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
                    <button type="button" className="hover:text-[#2F5C56] dark:hover:text-emerald-400">
                        <PaperClipIcon className="w-6 h-6" />
                    </button>
                    <button type="button" className="hover:text-[#2F5C56] dark:hover:text-emerald-400">
                        <MicrophoneIcon className="w-6 h-6" />
                    </button>
                </div>

                {/* Input Area */}
                <div className="flex gap-3 items-end">
                    <textarea
                        ref={composerRef}
                        value={composerText}
                        onChange={(event) => setComposerText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.ctrlKey) {
                                event.preventDefault();
                                void onSend();
                            }
                        }}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-[#2F5C56] focus:ring-1 focus:ring-[#2F5C56] resize-none h-12 max-h-32 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:focus:border-emerald-400 dark:focus:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-slate-800"
                        placeholder={isDeprecatedRoom ? t("chat.deprecatedPlaceholder") : t("chat.placeholder")}
                        rows={1}
                        disabled={isDeprecatedRoom}
                    />
                    <button
                        type="button"
                        onClick={() => void onSend()}
                        className="bg-[#2F5C56] hover:bg-[#244a45] text-white p-3 rounded-xl shadow-md transition-colors flex items-center justify-center dark:bg-emerald-500 dark:hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isDeprecatedRoom}
                    >
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
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
                                            setInviteError(
                                                err instanceof Error ? err.message : t("chat.inviteSettingsFailed"),
                                            );
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
                                            setInviteMemberError(
                                                err instanceof Error ? err.message : t("chat.inviteMemberFailed"),
                                            );
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
                                            setRenameError(
                                                err instanceof Error ? err.message : t("chat.renameGroupFailed"),
                                            );
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
                                            setRemoveMemberError(
                                                err instanceof Error ? err.message : t("chat.removeMemberFailed"),
                                            );
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
                    ) : (
                        <video src={mediaPreview.url} controls className="max-h-[90vh] max-w-[90vw] rounded-lg" />
                    )}
                </div>
            )}
        </div>
    );
};
