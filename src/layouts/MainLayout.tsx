import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import {
    ChatBubbleLeftRightIcon,
    BookOpenIcon,
    UserGroupIcon,
    Cog6ToothIcon,
    FolderIcon,
} from "@heroicons/react/24/outline";
import { ClientEvent, EventTimeline, EventType, Preset, RoomEvent, type MatrixEvent, type Room } from "matrix-js-sdk";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../stores/ThemeStore";
import { useAuthStore } from "../stores/AuthStore";
import { RoomList } from "../features/rooms";
import type { ContactSummary } from "../features/rooms/RoomList";
import {
    createChatSummaryJob,
    deleteChatSummaryJob,
    downloadChatSummaryJob,
    hubGetMe,
    hubMeUpdateLocale,
    hubMeUpdateTranslationLocale,
    hubTranslate,
    listChatSummaryJobs,
    type ChatSummaryJobItem,
} from "../api/hub";
import type { HubProfileSummary } from "../api/types";
import { removeContact } from "../api/contacts";
import { getOrCreateDirectRoom, hideDirectRoom } from "../matrix/direct";
import { CreateRoomModal } from "../features/groups/CreateRoomModal";
// RoomDetailsPanel 將在 ChatRoom 中整合使用
// import { RoomDetailsPanel, isRoomWithMultipleMembers } from "../features/groups/RoomDetailsPanel";
import { translationLanguageOptions } from "../constants/translationLanguages";
import {
    ensureNotificationSoundEnabled,
    isNotificationSoundSupported,
    playNotificationSound,
    type NotificationSoundMode,
} from "../utils/notificationSound";
import { updateStaffLanguage, updateStaffTranslationLanguage } from "../api/profile";
import { getSupabaseClient } from "../api/supabase";
import { setLanguage } from "../i18n";
import { DEPRECATED_DM_PREFIX } from "../constants/rooms";
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
    chatSearchGlobal,
    ChatSearchError,
    chatSearchRoom,
    type ChatSearchGlobalResponse,
    type ChatSearchMessageHit,
    type ChatSearchPersonHit,
} from "../features/chat/chatSearchApi";
import {
    getNotebookAdapter,
    NotebookPanel,
    NotebookSidebar,
    resolveNotebookCapabilities,
    type SummarySearchPersonItem,
    type SummarySearchRoomItem,
    type SummarySearchTarget,
    useNotebookModule,
} from "../features/notebook";
import {
    getCompanyNotebookAiSettings,
    getNotebookCapabilities,
    NotebookServiceError,
} from "../services/notebookApi";
import { buildNotebookAuth } from "../features/notebook/utils/buildNotebookAuth";

// Placeholder for RoomList and ChatArea to be implemented later
// For now, we just create the layout structure
type NavBarItemProps = {
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    active?: boolean;
    onClick?: () => void;
    badgeCount?: number;
    className?: string;
};

type SharedContactRoomEntry = {
    roomId: string;
    displayName: string;
    memberCount: number;
    lastActive: number;
};

type SummaryChatMessage = {
    eventId: string;
    sender: string;
    ts: string | null;
    text: string;
    translatedText: string;
};

const NavBarItem = ({ icon: Icon, active, onClick, badgeCount, className = "" }: NavBarItemProps) => (
    <div
        onClick={onClick}
        className={`
            h-10 w-10 rounded-lg flex items-center justify-center cursor-pointer transition-colors
            lg:h-16 lg:w-full lg:rounded-none
            ${active ? "text-[#2F5C56] bg-gray-800" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"}
            ${className}
        `}
    >
        <div className="relative">
            <Icon className="w-7 h-7" />
            {typeof badgeCount === "number" && badgeCount > 0 ? (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-semibold flex items-center justify-center ring-2 ring-gray-900">
                    {badgeCount > 99 ? "99+" : badgeCount}
                </span>
            ) : null}
            {active && (
                <div className="absolute -left-5 top-1/2 hidden h-8 w-1 -translate-y-1/2 rounded-r-full bg-[#2F5C56] lg:block" />
            )}
        </div>
    </div>
);

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

function formatMatrixUserLocalId(matrixUserId: string | null | undefined): string {
    const raw = String(matrixUserId || "").trim();
    if (!raw) return "";
    const withoutPrefix = raw.startsWith("@") ? raw.slice(1) : raw;
    const colonIndex = withoutPrefix.indexOf(":");
    if (colonIndex <= 0) return withoutPrefix;
    return withoutPrefix.slice(0, colonIndex);
}

function resolveRoomListDisplayName(room: Room, myUserId: string | null): string {
    const fallback = room.name || room.getCanonicalAlias() || room.roomId;
    const normalizedMyUserId = myUserId || null;
    const joinedMembers = room.getJoinedMembers();
    if (normalizedMyUserId && joinedMembers.length === 2) {
        const other = joinedMembers.find((member) => member.userId !== normalizedMyUserId);
        if (other) {
            return other.name || formatMatrixUserLocalId(other.userId) || other.userId || fallback;
        }
    }

    if (normalizedMyUserId) {
        const selfMemberEvent = room.currentState.getStateEvents(EventType.RoomMember, normalizedMyUserId);
        const isDirect = Boolean(selfMemberEvent?.getContent()?.is_direct);
        if (isDirect) {
            const other = room
                .getMembers()
                .find((member) => member.userId !== normalizedMyUserId && (member.membership === "join" || member.membership === "invite"));
            if (other) {
                return other.name || formatMatrixUserLocalId(other.userId) || other.userId || fallback;
            }
        }
    }

    return fallback;
}

function resolveRoomCreatedAt(room: Room): number | null {
    const createEvent = room.currentState.getStateEvents(EventType.RoomCreate, "");
    if (!createEvent) return null;
    const ts = createEvent.getTs();
    return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function buildDateRangeIsoStart(dateValue: string): string | null {
    const trimmed = String(dateValue || "").trim();
    if (!trimmed) return null;
    const date = new Date(`${trimmed}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildDateRangeIsoEnd(dateValue: string): string | null {
    const trimmed = String(dateValue || "").trim();
    if (!trimmed) return null;
    const date = new Date(`${trimmed}T23:59:59.999`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJwtSub(token: string | null | undefined): string | null {
    const raw = String(token || "").trim();
    if (!raw) return null;
    const parts = raw.split(".");
    if (parts.length < 2 || !parts[1]) return null;
    try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padding = "=".repeat((4 - (base64.length % 4)) % 4);
        const json = atob(base64 + padding);
        const parsed = JSON.parse(json) as { sub?: string };
        return typeof parsed.sub === "string" ? parsed.sub : null;
    } catch {
        return null;
    }
}

function getLoadedRoomEvents(room: Room, maxEvents = 4000): MatrixEvent[] {
    const out: MatrixEvent[] = [];
    const seen = new Set<string>();
    let timeline: EventTimeline | null = room.getLiveTimeline();
    while (timeline && out.length < maxEvents) {
        const events = timeline.getEvents();
        for (const event of events) {
            const key = event.getId() || `${event.getTs()}:${event.getSender()}:${event.getType()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(event);
            if (out.length >= maxEvents) break;
        }
        timeline = timeline.getNeighbouringTimeline(EventTimeline.BACKWARDS) ?? null;
    }
    return out;
}

const FILE_ROOM_SEARCH_DEBOUNCE_MS = 250;
const FILE_LIST_SEARCH_DEBOUNCE_MS = 250;
const CHAT_GLOBAL_SEARCH_DEBOUNCE_MS = 350;
const FILE_LIST_PAGE_SIZE = 80;
const FILE_HISTORY_TARGET_EVENTS = 260;
const FILE_HISTORY_SCROLLBACK_LIMIT = 50;
const FILE_HISTORY_MAX_ROUNDS = 6;

export const MainLayout: React.FC = () => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<"chat" | "notebook" | "contacts" | "files" | "orders" | "settings" | "account">("chat");
    const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
    const [pinnedRoomIds, setPinnedRoomIds] = useState<string[]>([]);
    const [inviteBadgeCount, setInviteBadgeCount] = useState(0);
    const [unreadBadgeCount, setUnreadBadgeCount] = useState(0);
    const [activeContact, setActiveContact] = useState<ContactSummary | null>(null);
    const [showContactMenu, setShowContactMenu] = useState(false);
    const [showRemoveContactConfirm, setShowRemoveContactConfirm] = useState(false);
    const [contactsRefreshToken, setContactsRefreshToken] = useState(0);
    const [fileLibraryTick, setFileLibraryTick] = useState(0);
    const [fileRoomSearch, setFileRoomSearch] = useState("");
    const [debouncedFileRoomSearch, setDebouncedFileRoomSearch] = useState("");
    const [selectedFileRoomId, setSelectedFileRoomId] = useState<string | null>(null);
    const [fileListSearch, setFileListSearch] = useState("");
    const [debouncedFileListSearch, setDebouncedFileListSearch] = useState("");
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
    const [filePreview, setFilePreview] = useState<{ url: string; type: "image" | "video" | "audio" | "pdf"; name: string } | null>(null);
    const [previewZoom, setPreviewZoom] = useState(1);
    const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
    const previewDraggingRef = useRef(false);
    const previewDragStartRef = useRef({ x: 0, y: 0 });
    const previewDragOriginRef = useRef({ x: 0, y: 0 });
    const [jumpToEventId, setJumpToEventId] = useState<string | null>(null);
    const [chatGlobalSearchQuery, setChatGlobalSearchQuery] = useState("");
    const [debouncedChatGlobalSearchQuery, setDebouncedChatGlobalSearchQuery] = useState("");
    const [chatGlobalSearchOpen, setChatGlobalSearchOpen] = useState(false);
    const [chatGlobalSearchLoading, setChatGlobalSearchLoading] = useState(false);
    const [chatGlobalSearchError, setChatGlobalSearchError] = useState<string | null>(null);
    const [chatGlobalSearchResult, setChatGlobalSearchResult] = useState<ChatSearchGlobalResponse | null>(null);
    const [chatGlobalSearchCursor, setChatGlobalSearchCursor] = useState<string | null>(null);
    const [summarySearchQuery, setSummarySearchQuery] = useState("");
    const [debouncedSummarySearchQuery, setDebouncedSummarySearchQuery] = useState("");
    const [summarySearchLoading, setSummarySearchLoading] = useState(false);
    const [summarySearchError, setSummarySearchError] = useState<string | null>(null);
    const [summaryPeopleResults, setSummaryPeopleResults] = useState<SummarySearchPersonItem[]>([]);
    const [summaryRoomResults, setSummaryRoomResults] = useState<SummarySearchRoomItem[]>([]);
    const [summarySelectedTarget, setSummarySelectedTarget] = useState<SummarySearchTarget | null>(null);
    const [summaryStartDate, setSummaryStartDate] = useState("");
    const [summaryEndDate, setSummaryEndDate] = useState("");
    const [summaryContentLoading, setSummaryContentLoading] = useState(false);
    const [summaryContentError, setSummaryContentError] = useState<string | null>(null);
    const [summaryChatMessages, setSummaryChatMessages] = useState<SummaryChatMessage[]>([]);
    const [summaryJobs, setSummaryJobs] = useState<ChatSummaryJobItem[]>([]);
    const [summaryJobsLoading, setSummaryJobsLoading] = useState(false);
    const [summaryJobsError, setSummaryJobsError] = useState<string | null>(null);
    const [summaryJobActionBusy, setSummaryJobActionBusy] = useState(false);
    const [summaryGenerationNotice, setSummaryGenerationNotice] = useState<string | null>(null);
    const [selectedSharedRoomId, setSelectedSharedRoomId] = useState<string | null>(null);
    const [creatingContactRoom, setCreatingContactRoom] = useState(false);
    const [contactRoomActionError, setContactRoomActionError] = useState<string | null>(null);
    const [mobileView, setMobileView] = useState<"list" | "detail">("list");
    const [settingsDetail, setSettingsDetail] = useState<
        "none" | "chat-language" | "translation-default"
    >("none");
    const [notebookSidebarMode, setNotebookSidebarMode] = useState<"notebook" | "chatSummary">("notebook");
    const [summaryDetailTab, setSummaryDetailTab] = useState<"chatContent" | "summaryList">("chatContent");
    const [displayLanguage, setDisplayLanguage] = useState<string>("en");
    const [chatReceiveLanguage, setChatReceiveLanguage] = useState<string>("en");
    const [pendingChatReceiveLanguage, setPendingChatReceiveLanguage] = useState<string>("en");
    const [translationDefaultView, setTranslationDefaultView] = useState<"translated" | "original">("translated");
    const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
    const [removedFromRoomNotice, setRemovedFromRoomNotice] = useState<{ roomName: string } | null>(null);
    const chatGlobalSearchPanelRef = useRef<HTMLDivElement | null>(null);
    const contactMenuRef = useRef<HTMLDivElement | null>(null);
    const contactMenuButtonRef = useRef<HTMLButtonElement | null>(null);
    const themeMode = useThemeStore((state) => state.mode);
    const setThemeMode = useThemeStore((state) => state.setMode);
    const matrixCredentials = useAuthStore((state) => state.matrixCredentials);
    const matrixClient = useAuthStore((state) => state.matrixClient);
    const hubSession = useAuthStore((state) => state.hubSession);
    const hubAccessToken = hubSession?.access_token ?? null;
    const hubSessionExpiresAt = hubSession?.expires_at ?? null;
    const matrixAccessToken = useAuthStore((state) => state.matrixCredentials?.access_token ?? null);
    const matrixHsUrl = useAuthStore((state) => state.matrixCredentials?.hs_url ?? null);
    const userType = useAuthStore((state) => state.userType);
    const setHubSession = useAuthStore((state) => state.setHubSession);
    const clearSession = useAuthStore((state) => state.clearSession);
    const navigate = useNavigate();
    const [showAccountMenu, setShowAccountMenu] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);
    const accountButtonRef = useRef<HTMLButtonElement | null>(null);
    const avatarUploadInputRef = useRef<HTMLInputElement | null>(null);
    const [meProfile, setMeProfile] = useState<HubProfileSummary | null>(null);
    const [accountAvatarUrl, setAccountAvatarUrl] = useState<string | null>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [avatarUploadFeedback, setAvatarUploadFeedback] = useState<string | null>(null);
    const [notebookApiBaseUrlOverride, setNotebookApiBaseUrlOverride] = useState<string | null>(null);
    const [notebookUploadLimitMb, setNotebookUploadLimitMb] = useState<number>(20);
    const [hubMeResolved, setHubMeResolved] = useState(false);
    const fallbackAccountId = (matrixCredentials?.user_id || "User").replace(/^@/, "").split(":")[0] || "User";
    const accountId = meProfile?.user_local_id || fallbackAccountId;
    const accountInitial = accountId.charAt(0).toUpperCase() || "U";
    const accountSubtitleParts = [meProfile?.display_name, meProfile?.company_name].filter(
        (value): value is string => Boolean(value),
    );
    const accountSubtitle = accountSubtitleParts.length
        ? accountSubtitleParts.join(" · ")
        : t("layout.accountSubtitleFallback");
    const displayLangOptions = [
        { value: "en", label: t("language.english") },
        { value: "zh-CN", label: t("language.chineseSimplified") },
    ];
    const localeTokenExpired = hubSessionExpiresAt ? hubSessionExpiresAt * 1000 <= Date.now() : false;
    const translationDefaultStorageKey = useMemo(
        () => `gtt_translation_default_view:${matrixCredentials?.user_id ?? "guest"}`,
        [matrixCredentials?.user_id],
    );
    const notificationSoundStorageKey = useMemo(
        () => `gtt_notification_sound:${matrixCredentials?.user_id ?? "guest"}`,
        [matrixCredentials?.user_id],
    );
    const [notificationSoundMode, setNotificationSoundMode] = useState<NotificationSoundMode>("classic");
    const [notificationSoundHydrated, setNotificationSoundHydrated] = useState(false);
    const meUpdateToken = hubAccessToken && !localeTokenExpired ? hubAccessToken : null;
    const meUpdateOptions = undefined;
    const [capabilityValues, setCapabilityValues] = useState<string[]>([]);
    const [capabilityLoaded, setCapabilityLoaded] = useState(false);
    const [capabilityError, setCapabilityError] = useState<string | null>(null);
    const [refreshingNotebookToken, setRefreshingNotebookToken] = useState(false);
    const notebookRefreshBackoffUntilRef = useRef(0);
    const notebookRefreshFailureCountRef = useRef(0);
    const notebookRefreshFlightRef = useRef<Promise<boolean> | null>(null);
    const notebookRefreshFlightTimerRef = useRef<number | null>(null);
    const notebookUserSubRef = useRef<string | null>(parseJwtSub(hubSession?.access_token));
    const [capabilityRefreshSeq, setCapabilityRefreshSeq] = useState(0);
    const [capabilityTokenRefreshSeq, setCapabilityTokenRefreshSeq] = useState(0);
    const { notebookAuth, notebookToken } = useMemo(() => buildNotebookAuth({
        hubSession,
        matrixCredentials,
        userType,
        capabilities: capabilityValues,
        apiBaseUrl: notebookApiBaseUrlOverride,
    }), [hubSession, matrixCredentials, userType, capabilityValues, notebookApiBaseUrlOverride]);
    const capabilityToken = notebookToken.accessToken;
    const notebookAdapter = useMemo(() => getNotebookAdapter(), []);
    const notebookCapabilityState = useMemo(
        () =>
            resolveNotebookCapabilities({
                userType,
                capabilities: capabilityValues,
                loaded: capabilityLoaded,
            }),
        [capabilityLoaded, capabilityValues, userType],
    );
    const resolveAvatarUrl = useCallback((mxcUrl: string | null | undefined): string | null => {
        if (!matrixClient || !mxcUrl) return null;
        return matrixClient.mxcUrlToHttp(mxcUrl, 96, 96, "crop") ?? matrixClient.mxcUrlToHttp(mxcUrl) ?? null;
    }, [matrixClient]);
    useEffect(() => {
        notebookUserSubRef.current = parseJwtSub(hubSession?.access_token);
    }, [hubSession?.access_token]);

    const refreshNotebookToken = useCallback(async (options?: { force?: boolean }): Promise<boolean> => {
        if (!hubSession?.refresh_token) return false;
        if (!options?.force && Date.now() < notebookRefreshBackoffUntilRef.current) return false;
        if (notebookRefreshFlightRef.current) return notebookRefreshFlightRef.current;

        const flight = (async (): Promise<boolean> => {
            setRefreshingNotebookToken(true);
            try {
                const supabase = getSupabaseClient();
                const { data, error } = await supabase.auth.refreshSession({
                    refresh_token: hubSession.refresh_token,
                });
                if (error) {
                    throw error;
                }
                if (!data.session?.access_token) {
                    throw new Error("INVALID_AUTH_TOKEN");
                }

                const expectedSub = notebookUserSubRef.current || parseJwtSub(hubSession.access_token);
                const nextUserId = data.session.user?.id || null;
                const nextSub = parseJwtSub(data.session.access_token);
                const nextIdentity = nextUserId || nextSub;
                if (expectedSub && nextIdentity && expectedSub !== nextIdentity) {
                    clearSession();
                    setCapabilityError(t("layout.notebook.authFailed"));
                    return false;
                }

                setHubSession({
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token || hubSession.refresh_token,
                    expires_at: data.session.expires_at ?? undefined,
                });
                notebookUserSubRef.current = nextIdentity || expectedSub || null;
                notebookRefreshBackoffUntilRef.current = 0;
                notebookRefreshFailureCountRef.current = 0;
                setCapabilityTokenRefreshSeq((prev) => prev + 1);
                setCapabilityError(null);
                return true;
            } catch (error) {
                const status = (error as { status?: number } | null)?.status;
                const message = error instanceof Error ? error.message : String(error ?? "");
                const isRateLimited = status === 429 || message.includes("429") || message.toLowerCase().includes("too many requests");
                notebookRefreshFailureCountRef.current = Math.min(notebookRefreshFailureCountRef.current + 1, 6);
                const step = notebookRefreshFailureCountRef.current;
                const delayMs = isRateLimited
                    ? Math.min(15000 * (2 ** Math.max(0, step - 1)), 5 * 60 * 1000)
                    : Math.min(5000 * (2 ** Math.max(0, step - 1)), 60 * 1000);
                notebookRefreshBackoffUntilRef.current = Date.now() + delayMs;
                setCapabilityError(isRateLimited ? t("layout.notebook.systemBusy") : t("layout.notebook.authFailed"));
                return false;
            } finally {
                if (notebookRefreshFlightTimerRef.current) {
                    window.clearTimeout(notebookRefreshFlightTimerRef.current);
                    notebookRefreshFlightTimerRef.current = null;
                }
                notebookRefreshFlightRef.current = null;
                setRefreshingNotebookToken(false);
            }
        })();

        notebookRefreshFlightRef.current = flight;
        notebookRefreshFlightTimerRef.current = window.setTimeout(() => {
            if (notebookRefreshFlightRef.current === flight) {
                notebookRefreshFlightRef.current = null;
                setRefreshingNotebookToken(false);
            }
        }, 20000);
        return flight;
    }, [clearSession, hubSession?.refresh_token, hubSession?.access_token, setHubSession, t]);

    const retryNotebookCapability = useCallback(() => {
        notebookRefreshBackoffUntilRef.current = 0;
        notebookRefreshFailureCountRef.current = 0;
        setCapabilityRefreshSeq((prev) => prev + 1);
        void refreshNotebookToken({ force: true });
    }, [refreshNotebookToken]);

    useEffect(() => {
        if (
            notebookToken.reason !== "expired_hub_token" &&
            notebookToken.reason !== "missing_hub_token" &&
            notebookToken.reason !== "invalid_hub_token_format"
        ) {
            return;
        }
        if (!hubSession?.refresh_token || refreshingNotebookToken) return;
        void refreshNotebookToken();
    }, [hubSession?.refresh_token, notebookToken.reason, refreshNotebookToken, refreshingNotebookToken]);

    useEffect(() => {
        const shouldTryRefresh =
            notebookToken.reason === "expired_hub_token" ||
            notebookToken.reason === "missing_hub_token" ||
            notebookToken.reason === "invalid_hub_token_format";
        if (!shouldTryRefresh) return;
        if (!hubSession?.refresh_token) return;

        const onFocus = (): void => {
            if (refreshingNotebookToken) return;
            void refreshNotebookToken();
        };
        const onVisibility = (): void => {
            if (document.visibilityState !== "visible") return;
            if (refreshingNotebookToken) return;
            void refreshNotebookToken();
        };

        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [hubSession?.refresh_token, notebookToken.reason, refreshNotebookToken, refreshingNotebookToken]);
    const notebookModule = useNotebookModule({
        adapter: notebookAdapter,
        auth: notebookAuth,
        enabled: notebookCapabilityState.canUseNotebookBasic && activeTab === "notebook",
    });
    useEffect(() => {
        if (userType === "client" && notebookModule.sourceScope === "company") {
            notebookModule.setSourceScope("personal");
            notebookModule.setViewFilter("all");
        }
    }, [notebookModule, userType]);

    const handleDisplayLanguageChange = async (value: string): Promise<void> => {
        const previous = displayLanguage;
        setDisplayLanguage(value);
        if (value === "en" || value === "zh-CN") {
            setLanguage(value);
        }
        try {
            if (userType === "client" && meUpdateToken) {
                await hubMeUpdateLocale(meUpdateToken, value, meUpdateOptions);
            } else if (userType === "staff" && matrixAccessToken && matrixHsUrl) {
                await updateStaffLanguage(matrixAccessToken, matrixHsUrl, value);
            }
        } catch {
            setDisplayLanguage(previous);
            if (previous === "en" || previous === "zh-CN") {
                setLanguage(previous);
            }
        }
    };

    const handleChatReceiveLanguageChange = async (value: string): Promise<void> => {
        const previous = chatReceiveLanguage;
        setChatReceiveLanguage(value);
        try {
            if (userType === "client" && meUpdateToken) {
                await hubMeUpdateTranslationLocale(meUpdateToken, value, meUpdateOptions);
            } else if (userType === "staff" && matrixAccessToken && matrixHsUrl) {
                await updateStaffTranslationLanguage(matrixAccessToken, matrixHsUrl, value);
            }
        } catch {
            setChatReceiveLanguage(previous);
        }
    };

    useEffect(() => {
        if (!matrixClient) return undefined;
        let cancelled = false;
        void (async () => {
            try {
                await matrixClient.initRustCrypto();
            } catch {
                // fallback to non-crypto mode if rust crypto init fails
            }
            if (cancelled) return;
            matrixClient.startClient({ initialSyncLimit: 20 });
        })();
        return () => {
            cancelled = true;
            matrixClient.stopClient();
        };
    }, [matrixClient]);

    useEffect(() => {
        if (!matrixClient || !matrixCredentials?.user_id) return undefined;
        const myUserId = matrixCredentials.user_id;
        const shownForRoom = new Set<string>();

        const onMyMembership = (room: Room, membership: string, prevMembership?: string): void => {
            if (!room) return;
            if (membership !== "leave" && membership !== "ban") return;
            if (prevMembership !== "join" && prevMembership !== "invite") return;
            if (shownForRoom.has(room.roomId)) return;
            const selfMemberEvent = room.currentState.getStateEvents(EventType.RoomMember, myUserId);
            const sender = selfMemberEvent?.getSender();
            if (!sender || sender === myUserId) return;
            shownForRoom.add(room.roomId);
            traceEvent("popup.removed_from_room", {
                roomId: room.roomId,
                roomName: room.name || room.roomId,
                membership,
                prevMembership,
                sender,
                myUserId,
            });
            setRemovedFromRoomNotice({
                roomName: room.name || room.roomId,
            });
        };

        matrixClient.on(RoomEvent.MyMembership, onMyMembership);
        return () => {
            matrixClient.off(RoomEvent.MyMembership, onMyMembership);
        };
    }, [matrixClient, matrixCredentials?.user_id]);

    useEffect(() => {
        if (!matrixClient || !matrixCredentials?.user_id) return undefined;
        const myUserId = matrixCredentials.user_id;

        const onSync = (state: string): void => {
            traceEvent("matrix.sync", { state, myUserId });
        };

        const onMyMembership = (room: Room, membership: string, prevMembership?: string): void => {
            traceEvent("matrix.my_membership", {
                roomId: room.roomId,
                roomName: room.name || room.roomId,
                membership,
                prevMembership: prevMembership ?? null,
                myUserId,
                activeRoomId,
            });
        };

        const onTimeline = (
            event: MatrixEvent,
            room: Room | undefined,
            toStartOfTimeline: boolean | undefined,
            removed: boolean,
        ): void => {
            if (!room || removed || toStartOfTimeline) return;
            if (event.getType() !== EventType.RoomMember) return;
            const content = (event.getContent() ?? {}) as { membership?: string };
            const prev = (event.getPrevContent() ?? {}) as { membership?: string };
            traceEvent("matrix.member_timeline", {
                roomId: room.roomId,
                roomName: room.name || room.roomId,
                sender: event.getSender() ?? null,
                stateKey: event.getStateKey() ?? null,
                membership: content.membership ?? null,
                prevMembership: prev.membership ?? null,
                myUserId,
                activeRoomId,
            });
        };

        matrixClient.on(ClientEvent.Sync, onSync);
        matrixClient.on(RoomEvent.MyMembership, onMyMembership);
        matrixClient.on(RoomEvent.Timeline, onTimeline);
        return () => {
            matrixClient.off(ClientEvent.Sync, onSync);
            matrixClient.off(RoomEvent.MyMembership, onMyMembership);
            matrixClient.off(RoomEvent.Timeline, onTimeline);
        };
    }, [matrixClient, matrixCredentials?.user_id, activeRoomId]);

    useEffect(() => {
        traceEvent("ui.active_room_changed", { activeRoomId: activeRoomId ?? null, activeTab });
    }, [activeRoomId, activeTab]);

    useEffect(() => {
        if (matrixCredentials?.user_id) {
            localStorage.setItem("gt_matrix_user_id", matrixCredentials.user_id);
        }
    }, [matrixCredentials?.user_id]);

    // 更新瀏覽器標籤顯示未讀數
    useEffect(() => {
        const baseTitle = "GoTradeTalk";
        if (unreadBadgeCount > 0) {
            document.title = `(${unreadBadgeCount > 99 ? "99+" : unreadBadgeCount}) ${baseTitle}`;
        } else {
            document.title = baseTitle;
        }
    }, [unreadBadgeCount]);

    useEffect(() => {
        if (!hubAccessToken) {
            setMeProfile(null);
            setNotebookApiBaseUrlOverride(null);
            setNotebookUploadLimitMb(20);
            setHubMeResolved(true);
            return;
        }
        let isActive = true;
        setHubMeResolved(false);
        void (async () => {
            try {
                const response = await hubGetMe({
                    accessToken: hubAccessToken,
                    hsUrl: matrixHsUrl,
                    matrixUserId: matrixCredentials?.user_id,
                });
                if (!isActive) return;
                setMeProfile(response.profile);
                setNotebookApiBaseUrlOverride(response.notebook_api_base_url ?? null);
                if (response.profile?.locale) {
                    setDisplayLanguage(response.profile.locale);
                    if (response.profile.locale === "en" || response.profile.locale === "zh-CN") {
                        setLanguage(response.profile.locale);
                    }
                }
                if (response.profile?.translation_locale) {
                    setChatReceiveLanguage(response.profile.translation_locale);
                    setPendingChatReceiveLanguage(response.profile.translation_locale);
                }
            } catch {
                if (!isActive) return;
                setMeProfile(null);
                setNotebookApiBaseUrlOverride(null);
                setNotebookUploadLimitMb(20);
            } finally {
                if (isActive) {
                    setHubMeResolved(true);
                }
            }
        })();
        return () => {
            isActive = false;
        };
    }, [hubAccessToken, matrixHsUrl, matrixCredentials?.user_id]);

    useEffect(() => {
        if (!notebookAuth || !notebookApiBaseUrlOverride) {
            setNotebookUploadLimitMb(20);
            return;
        }
        let alive = true;
        void getCompanyNotebookAiSettings(notebookAuth)
            .then((response) => {
                if (!alive) return;
                const raw = Number(response?.notebook_upload_max_mb ?? 20);
                const normalized = Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(Math.floor(raw), 1), 200) : 20;
                setNotebookUploadLimitMb(normalized);
            })
            .catch(() => {
                if (!alive) return;
                setNotebookUploadLimitMb(20);
            });
        return () => {
            alive = false;
        };
    }, [notebookAuth, notebookApiBaseUrlOverride]);

    useEffect(() => {
        if (!capabilityToken) {
            if (
                notebookToken.reason === "expired_hub_token" ||
                notebookToken.reason === "missing_hub_token" ||
                notebookToken.reason === "invalid_hub_token_format"
            ) {
                setCapabilityValues([]);
                if (hubSession?.refresh_token) {
                    setCapabilityLoaded(false);
                    if (!refreshingNotebookToken) {
                        void refreshNotebookToken();
                    }
                    return;
                }
                setCapabilityLoaded(true);
                setCapabilityError(t("layout.notebook.authFailed"));
                return;
            }
            setCapabilityLoaded(true);
            setCapabilityValues([]);
            setCapabilityError(t("layout.notebook.authFailed"));
            return;
        }
        if (!hubMeResolved) {
            setCapabilityLoaded(false);
            setCapabilityError(null);
            return;
        }
        if (!notebookApiBaseUrlOverride) {
            setCapabilityLoaded(true);
            setCapabilityValues([]);
            if (userType === "client") {
                setCapabilityError(null);
            } else {
                setCapabilityError(t("layout.notebook.serviceMissing"));
            }
            return;
        }
        let alive = true;
        setCapabilityLoaded(false);
        setCapabilityError(null);
        void getNotebookCapabilities({
            accessToken: capabilityToken,
            apiBaseUrl: notebookApiBaseUrlOverride,
            hsUrl: matrixHsUrl,
            matrixUserId: matrixCredentials?.user_id,
        }).then((result) => {
            if (!alive) return;
            const values = Array.isArray(result.capabilities)
                ? result.capabilities.filter((value): value is string => typeof value === "string")
                : [];
            setCapabilityValues(values);
            setCapabilityLoaded(true);
            setCapabilityError(null);
        }).catch((error) => {
            if (!alive) return;
            setCapabilityValues([]);
            setCapabilityLoaded(true);
            if (error instanceof NotebookServiceError) {
                if (
                    error.code === "NO_VALID_HUB_TOKEN" ||
                    error.code === "INVALID_AUTH_TOKEN" ||
                    error.code === "INVALID_TOKEN_TYPE" ||
                    error.status === 401
                ) {
                    setCapabilityError(t("layout.notebook.authFailed"));
                    return;
                }
                if (error.code === "CAPABILITY_DISABLED") {
                    setCapabilityError(t("layout.notebook.capabilityDisabled"));
                    return;
                }
                if (error.code === "CAPABILITY_EXPIRED") {
                    setCapabilityError(t("layout.notebook.capabilityExpired"));
                    return;
                }
                if (error.code === "QUOTA_EXCEEDED") {
                    setCapabilityError(t("layout.notebook.quotaExceeded"));
                    return;
                }
                if (error.status >= 500) {
                    setCapabilityError(t("layout.notebook.systemBusy"));
                    return;
                }
            }
            setCapabilityError(t("layout.notebook.capabilityLoadFailed"));
        });
        return () => {
            alive = false;
        };
    }, [capabilityToken, notebookApiBaseUrlOverride, hubMeResolved, matrixCredentials?.user_id, matrixHsUrl, capabilityRefreshSeq, capabilityTokenRefreshSeq, notebookToken.reason, userType, t, hubSession?.refresh_token, refreshingNotebookToken, refreshNotebookToken]);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent): void => {
            const target = event.target as Node;
            if (accountMenuRef.current?.contains(target) || accountButtonRef.current?.contains(target)) return;
            setShowAccountMenu(false);
        };
        if (showAccountMenu) {
            document.addEventListener("click", onClickOutside);
        }
        return () => {
            document.removeEventListener("click", onClickOutside);
        };
    }, [showAccountMenu]);

    useEffect(() => {
        const raw = localStorage.getItem(translationDefaultStorageKey);
        setTranslationDefaultView(raw === "original" ? "original" : "translated");
    }, [translationDefaultStorageKey]);

    useEffect(() => {
        localStorage.setItem(translationDefaultStorageKey, translationDefaultView);
    }, [translationDefaultStorageKey, translationDefaultView]);

    useEffect(() => {
        setNotificationSoundHydrated(false);
        const raw = localStorage.getItem(notificationSoundStorageKey);
        if (raw === "off" || raw === "classic" || raw === "soft" || raw === "chime") {
            setNotificationSoundMode(raw);
            setNotificationSoundHydrated(true);
            return;
        }
        setNotificationSoundMode("classic");
        setNotificationSoundHydrated(true);
    }, [notificationSoundStorageKey]);

    useEffect(() => {
        if (!notificationSoundHydrated) return;
        localStorage.setItem(notificationSoundStorageKey, notificationSoundMode);
    }, [notificationSoundHydrated, notificationSoundMode, notificationSoundStorageKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedFileRoomSearch(fileRoomSearch);
        }, FILE_ROOM_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [fileRoomSearch]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedFileListSearch(fileListSearch);
        }, FILE_LIST_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [fileListSearch]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedChatGlobalSearchQuery(chatGlobalSearchQuery.trim());
        }, CHAT_GLOBAL_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [chatGlobalSearchQuery]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSummarySearchQuery(summarySearchQuery.trim());
        }, CHAT_GLOBAL_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [summarySearchQuery]);

    useEffect(() => {
        if (activeTab !== "contacts") {
            setActiveContact(null);
            setShowContactMenu(false);
        }
        if (activeTab !== "files") {
            setActiveFileMenuEventId(null);
            setShowFileToolbarMenu(false);
            setFileBatchMode(false);
            setSelectedFileIds([]);
            setFileActionError(null);
        }
        setSettingsDetail("none");
    }, [activeTab]);

    useEffect(() => {
        if (notebookSidebarMode !== "chatSummary") return;
        setSummaryDetailTab("chatContent");
    }, [notebookSidebarMode]);

    useEffect(() => {
        setSummaryContentError(null);
        setSummaryChatMessages([]);
    }, [summarySelectedTarget, summaryStartDate, summaryEndDate]);

    useEffect(() => {
        if (!matrixClient || !matrixCredentials?.user_id) {
            setAccountAvatarUrl(null);
            return;
        }
        let alive = true;
        const myUserId = matrixCredentials.user_id;

        const refreshMyAvatar = async (): Promise<void> => {
            const cachedMxc = matrixClient.getUser(myUserId)?.avatarUrl;
            if (cachedMxc) {
                if (!alive) return;
                setAccountAvatarUrl(resolveAvatarUrl(cachedMxc));
                return;
            }
            try {
                const profile = await matrixClient.getProfileInfo(myUserId);
                if (!alive) return;
                const serverMxc = typeof profile?.avatar_url === "string" ? profile.avatar_url : null;
                setAccountAvatarUrl(resolveAvatarUrl(serverMxc));
            } catch {
                if (!alive) return;
                const fallbackMxc = matrixClient.getUser(myUserId)?.avatarUrl;
                setAccountAvatarUrl(resolveAvatarUrl(fallbackMxc));
            }
        };

        void refreshMyAvatar();

        const onSync = (): void => {
            void refreshMyAvatar();
        };
        const onEvent = (event: MatrixEvent): void => {
            if (event.getType() !== "m.presence") return;
            if (event.getSender() !== myUserId) return;
            void refreshMyAvatar();
        };

        matrixClient.on(ClientEvent.Sync, onSync);
        matrixClient.on(ClientEvent.Event, onEvent);
        return () => {
            alive = false;
            matrixClient.off(ClientEvent.Sync, onSync);
            matrixClient.off(ClientEvent.Event, onEvent);
        };
    }, [matrixClient, matrixCredentials?.user_id, resolveAvatarUrl]);

    useEffect(() => {
        if (activeTab === "contacts") {
            setContactsRefreshToken((prev) => prev + 1);
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === "notebook" && !notebookCapabilityState.canUseNotebookBasic) {
            setActiveTab("chat");
        }
    }, [activeTab, notebookCapabilityState.canUseNotebookBasic]);

    useEffect(() => {
        if (!matrixClient) return undefined;
        const onTimelineChanged = (): void => setFileLibraryTick((prev) => prev + 1);
        matrixClient.on(RoomEvent.Timeline, onTimelineChanged);
        matrixClient.on(RoomEvent.TimelineReset, onTimelineChanged);
        matrixClient.on(ClientEvent.Room, onTimelineChanged);
        matrixClient.on(RoomEvent.MyMembership, onTimelineChanged);
        return () => {
            matrixClient.off(RoomEvent.Timeline, onTimelineChanged);
            matrixClient.off(RoomEvent.TimelineReset, onTimelineChanged);
            matrixClient.off(ClientEvent.Room, onTimelineChanged);
            matrixClient.off(RoomEvent.MyMembership, onTimelineChanged);
        };
    }, [matrixClient]);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent): void => {
            const target = event.target as Node;
            if (contactMenuRef.current?.contains(target) || contactMenuButtonRef.current?.contains(target)) return;
            setShowContactMenu(false);
        };
        if (showContactMenu) {
            document.addEventListener("click", onClickOutside);
        }
        return () => {
            document.removeEventListener("click", onClickOutside);
        };
    }, [showContactMenu]);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent): void => {
            const target = event.target as Node;
            if (chatGlobalSearchPanelRef.current?.contains(target)) return;
            setChatGlobalSearchOpen(false);
        };
        if (chatGlobalSearchOpen) {
            document.addEventListener("click", onClickOutside);
        }
        return () => {
            document.removeEventListener("click", onClickOutside);
        };
    }, [chatGlobalSearchOpen]);

    useEffect(() => {
        if (!isNotificationSoundSupported()) return;
        const unlock = (): void => {
            ensureNotificationSoundEnabled();
            window.removeEventListener("pointerdown", unlock);
            window.removeEventListener("keydown", unlock);
        };
        window.addEventListener("pointerdown", unlock);
        window.addEventListener("keydown", unlock);
        return () => {
            window.removeEventListener("pointerdown", unlock);
            window.removeEventListener("keydown", unlock);
        };
    }, []);

    const onLogout = (): void => {
        clearSession();
        navigate("/auth");
    };

    const onUploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || !matrixClient) return;
        setAvatarUploading(true);
        setAvatarUploadFeedback(null);
        try {
            const uploadResult = (await matrixClient.uploadContent(file, {
                includeFilename: false,
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
                throw new Error("Avatar upload failed");
            }
            await matrixClient.setAvatarUrl(mxcUrl);
            setAccountAvatarUrl(resolveAvatarUrl(mxcUrl));
            setAvatarUploadFeedback("Avatar updated");
        } catch {
            setAvatarUploadFeedback("Avatar upload failed");
        } finally {
            setAvatarUploading(false);
        }
    };

    const getContactAvatarUrl = useCallback((matrixUserId?: string | null): string | null => {
        if (!matrixClient || !matrixUserId) return null;
        const user = matrixClient.getUser(matrixUserId);
        return resolveAvatarUrl(user?.avatarUrl);
    }, [matrixClient, resolveAvatarUrl]);

    const runChatGlobalSearch = useCallback(async (params?: { forceQuery?: string; cursor?: string; append?: boolean }) => {
        const q = (params?.forceQuery ?? debouncedChatGlobalSearchQuery).trim();
        if (!q) {
            setChatGlobalSearchResult(null);
            setChatGlobalSearchCursor(null);
            setChatGlobalSearchError(null);
            return;
        }
        if (!hubAccessToken || !matrixAccessToken || !matrixHsUrl || !matrixCredentials?.user_id) {
            setChatGlobalSearchError("NO_VALID_HUB_TOKEN：請重新登入後再使用聊天搜尋");
            return;
        }
        setChatGlobalSearchLoading(true);
        setChatGlobalSearchError(null);
        try {
            const response = await chatSearchGlobal({
                accessToken: hubAccessToken,
                matrixAccessToken,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials.user_id,
            }, {
                q,
                limit: 20,
                cursor: params?.cursor,
            });
            if (params?.append) {
                setChatGlobalSearchResult((prev) => {
                    if (!prev) return response;
                    return {
                        people_hits: [...prev.people_hits, ...response.people_hits],
                        room_hits: [...prev.room_hits, ...response.room_hits],
                        message_hits: [...prev.message_hits, ...response.message_hits],
                        next_cursor: response.next_cursor,
                    };
                });
            } else {
                setChatGlobalSearchResult(response);
            }
            setChatGlobalSearchCursor(response.next_cursor ?? null);
        } catch (error) {
            if (error instanceof ChatSearchError) {
                if (error.status === 401) {
                    setChatGlobalSearchError("401：聊天搜尋驗證失敗，請重新登入");
                } else if (error.status === 403) {
                    setChatGlobalSearchError("403：目前無權限使用聊天搜尋");
                } else {
                    setChatGlobalSearchError(error.message || "聊天搜尋失敗");
                }
            } else {
                setChatGlobalSearchError(error instanceof Error ? error.message : "聊天搜尋失敗");
            }
        } finally {
            setChatGlobalSearchLoading(false);
        }
    }, [debouncedChatGlobalSearchQuery, hubAccessToken, matrixAccessToken, matrixCredentials?.user_id, matrixHsUrl]);

    useEffect(() => {
        if (!chatGlobalSearchOpen) return;
        if (!debouncedChatGlobalSearchQuery) return;
        void runChatGlobalSearch();
    }, [chatGlobalSearchOpen, debouncedChatGlobalSearchQuery, runChatGlobalSearch]);

    const runSummarySearch = useCallback(async (params?: { forceQuery?: string }) => {
        const q = (params?.forceQuery ?? debouncedSummarySearchQuery).trim();
        if (!q) {
            setSummaryPeopleResults([]);
            setSummaryRoomResults([]);
            setSummarySearchError(null);
            setSummarySelectedTarget(null);
            return;
        }
        if (!hubAccessToken || !matrixAccessToken || !matrixHsUrl || !matrixCredentials?.user_id) {
            setSummarySearchError(t("layout.notebook.summarySearchAuthRequired", "Please sign in again before searching."));
            setSummaryPeopleResults([]);
            setSummaryRoomResults([]);
            setSummarySelectedTarget(null);
            return;
        }

        setSummarySearchLoading(true);
        setSummarySearchError(null);
        try {
            const response = await chatSearchGlobal({
                accessToken: hubAccessToken,
                matrixAccessToken,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials.user_id,
            }, {
                q,
                limit: 20,
            });
            const peopleHits: SummarySearchPersonItem[] = response.people_hits
                .filter((hit) => Boolean(hit.matrix_user_id))
                .map((hit) => {
                    const matrixUserId = hit.matrix_user_id as string;
                    return {
                        id: matrixUserId,
                        label: hit.display_name || hit.user_local_id || matrixUserId,
                        meta: hit.company_name || matrixUserId,
                    };
                });
            const roomHits: SummarySearchRoomItem[] = response.room_hits.map((hit) => {
                const room = matrixClient?.getRoom(hit.room_id) ?? null;
                const label = room
                    ? resolveRoomListDisplayName(room, matrixCredentials?.user_id ?? null)
                    : (hit.room_name || hit.room_id);
                const createdAtTs = room ? resolveRoomCreatedAt(room) : null;
                const fallbackTs = hit.last_ts ? Date.parse(hit.last_ts) : NaN;
                const displayTs = createdAtTs ?? (Number.isFinite(fallbackTs) ? fallbackTs : null);
                return {
                    id: hit.room_id,
                    label,
                    meta: displayTs
                        ? t("layout.notebook.summaryCreatedDate", {
                            date: new Date(displayTs).toLocaleString(),
                            defaultValue: "Created at: {{date}}",
                        })
                        : null,
                };
            });

            setSummaryPeopleResults(peopleHits);
            setSummaryRoomResults(roomHits);
            setSummarySelectedTarget((prev) => {
                if (!prev) return null;
                const stillExists = prev.type === "person"
                    ? peopleHits.some((item) => item.id === prev.id)
                    : roomHits.some((item) => item.id === prev.id);
                return stillExists ? prev : null;
            });
        } catch (error) {
            if (error instanceof ChatSearchError) {
                if (error.status === 401) {
                    setSummarySearchError(t("layout.notebook.summarySearchUnauthorized", "Authentication failed. Please sign in again."));
                } else if (error.status === 403) {
                    setSummarySearchError(t("layout.notebook.summarySearchForbidden", "You do not have permission to use chat search."));
                } else {
                    setSummarySearchError(error.message || t("layout.notebook.summarySearchFailed", "Chat search failed."));
                }
            } else {
                setSummarySearchError(error instanceof Error ? error.message : t("layout.notebook.summarySearchFailed", "Chat search failed."));
            }
            setSummaryPeopleResults([]);
            setSummaryRoomResults([]);
            setSummarySelectedTarget(null);
        } finally {
            setSummarySearchLoading(false);
        }
    }, [
        debouncedSummarySearchQuery,
        hubAccessToken,
        matrixAccessToken,
        matrixClient,
        matrixCredentials?.user_id,
        matrixHsUrl,
        t,
    ]);

    useEffect(() => {
        if (activeTab !== "notebook" || notebookSidebarMode !== "chatSummary") return;
        if (!debouncedSummarySearchQuery) {
            setSummaryPeopleResults([]);
            setSummaryRoomResults([]);
            setSummarySearchError(null);
            setSummarySelectedTarget(null);
            return;
        }
        void runSummarySearch();
    }, [activeTab, notebookSidebarMode, debouncedSummarySearchQuery, runSummarySearch]);

    const resolveSummaryTargetRoomId = useCallback((target: SummarySearchTarget): string | null => {
        if (!matrixClient) return null;
        if (target.type === "room") return target.id;
        const candidates = matrixClient
            .getRooms()
            .filter((room) => {
                if (room.getMyMembership() !== "join" || room.isSpaceRoom()) return false;
                const member = room.getMember(target.id);
                return member?.membership === "join";
            })
            .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
        return candidates[0]?.roomId ?? null;
    }, [matrixClient]);

    const loadSummaryChatContent = useCallback(async () => {
        if (!summarySelectedTarget || !summaryStartDate || !summaryEndDate) return;
        if (summaryStartDate > summaryEndDate) {
            setSummaryContentError(t("layout.notebook.summaryDateRangeInvalid", "Start date must be earlier than or equal to end date."));
            return;
        }
        if (!hubAccessToken || !matrixAccessToken || !matrixHsUrl || !matrixCredentials?.user_id) {
            setSummaryContentError(t("layout.notebook.summarySearchAuthRequired", "Please sign in again before searching."));
            return;
        }
        const roomId = resolveSummaryTargetRoomId(summarySelectedTarget);
        if (!roomId) {
            setSummaryContentError(t("layout.notebook.summaryRoomResolveFailed", "No shared room found for this target."));
            return;
        }

        setSummaryContentLoading(true);
        setSummaryContentError(null);
        try {
            const response = await chatSearchRoom({
                accessToken: hubAccessToken,
                matrixAccessToken,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials.user_id,
            }, {
                roomId,
                type: "messages",
                limit: 40,
                fromTs: buildDateRangeIsoStart(summaryStartDate) ?? undefined,
                toTs: buildDateRangeIsoEnd(summaryEndDate) ?? undefined,
            });

            const messages: SummaryChatMessage[] = [];
            for (const hit of response.message_hits) {
                const sourceText = String(hit.preview || "").trim();
                if (!sourceText) continue;
                let translatedText = sourceText;
                try {
                    const translated = await hubTranslate({
                        accessToken: hubAccessToken,
                        text: sourceText,
                        targetLang: chatReceiveLanguage,
                        roomId,
                        messageId: hit.event_id,
                        sourceMatrixUserId: hit.sender || undefined,
                        hsUrl: matrixHsUrl,
                        matrixUserId: matrixCredentials.user_id,
                    });
                    translatedText = String(translated.translation || "").trim() || sourceText;
                } catch {
                    translatedText = sourceText;
                }
                messages.push({
                    eventId: hit.event_id,
                    sender: formatMatrixUserLocalId(hit.sender) || (hit.sender || "unknown"),
                    ts: hit.ts || null,
                    text: sourceText,
                    translatedText,
                });
            }
            setSummaryChatMessages(messages);
            setSummaryDetailTab("chatContent");
        } catch (error) {
            if (error instanceof ChatSearchError) {
                setSummaryContentError(error.message || t("layout.notebook.summarySearchFailed", "Chat search failed."));
            } else {
                setSummaryContentError(error instanceof Error ? error.message : t("layout.notebook.summarySearchFailed", "Chat search failed."));
            }
            setSummaryChatMessages([]);
        } finally {
            setSummaryContentLoading(false);
        }
    }, [
        chatReceiveLanguage,
        hubAccessToken,
        matrixAccessToken,
        matrixCredentials?.user_id,
        matrixHsUrl,
        resolveSummaryTargetRoomId,
        summaryEndDate,
        summarySelectedTarget,
        summaryStartDate,
        t,
    ]);

    const loadSummaryJobs = useCallback(async () => {
        if (!hubAccessToken) return;
        setSummaryJobsLoading(true);
        setSummaryJobsError(null);
        try {
            const response = await listChatSummaryJobs(hubAccessToken);
            setSummaryJobs(Array.isArray(response.items) ? response.items : []);
        } catch (error) {
            setSummaryJobsError(error instanceof Error ? error.message : t("layout.notebook.summaryJobsLoadFailed", "Failed to load summary list."));
            setSummaryJobs([]);
        } finally {
            setSummaryJobsLoading(false);
        }
    }, [hubAccessToken, t]);

    const hasProcessingSummaryJob = useMemo(
        () => summaryJobs.some((job) => job.status === "processing"),
        [summaryJobs],
    );

    const onStartGenerateSummary = useCallback(async () => {
        if (!hubAccessToken || !summarySelectedTarget || !summaryStartDate || !summaryEndDate) return;
        if (hasProcessingSummaryJob || summaryJobActionBusy) {
            setSummaryGenerationNotice(t("layout.notebook.summaryAlreadyGenerating", "A summary is already generating. Please wait."));
            return;
        }
        if (summaryChatMessages.length === 0) {
            setSummaryGenerationNotice(t("layout.notebook.summaryNoChatContent", "No chat content in the selected range."));
            return;
        }
        const roomId = resolveSummaryTargetRoomId(summarySelectedTarget);
        if (!roomId) {
            setSummaryGenerationNotice(t("layout.notebook.summaryRoomResolveFailed", "No shared room found for this target."));
            return;
        }

        setSummaryJobActionBusy(true);
        setSummaryGenerationNotice(t("layout.notebook.summaryGeneratingNotice", "Summary generation started. Please wait."));
        try {
            await createChatSummaryJob({
                accessToken: hubAccessToken,
                targetLabel: summarySelectedTarget.label,
                roomId,
                fromDate: summaryStartDate,
                toDate: summaryEndDate,
                messages: summaryChatMessages.map((item) => ({
                    sender: item.sender,
                    ts: item.ts,
                    text: item.translatedText || item.text,
                })),
            });
            await loadSummaryJobs();
            setSummaryDetailTab("summaryList");
        } catch (error) {
            setSummaryGenerationNotice(error instanceof Error ? error.message : t("layout.notebook.summaryGenerateFailed", "Failed to start summary generation."));
        } finally {
            setSummaryJobActionBusy(false);
        }
    }, [
        hasProcessingSummaryJob,
        hubAccessToken,
        loadSummaryJobs,
        resolveSummaryTargetRoomId,
        summaryChatMessages,
        summaryEndDate,
        summaryJobActionBusy,
        summarySelectedTarget,
        summaryStartDate,
        t,
    ]);

    const onDeleteSummaryJob = useCallback(async (id: string) => {
        if (!hubAccessToken || !id) return;
        setSummaryJobActionBusy(true);
        try {
            await deleteChatSummaryJob(hubAccessToken, id);
            await loadSummaryJobs();
        } catch (error) {
            setSummaryJobsError(error instanceof Error ? error.message : t("layout.notebook.summaryDeleteFailed", "Failed to delete summary."));
        } finally {
            setSummaryJobActionBusy(false);
        }
    }, [hubAccessToken, loadSummaryJobs, t]);

    const onDownloadSummaryJob = useCallback(async (job: ChatSummaryJobItem) => {
        if (!hubAccessToken) return;
        setSummaryJobActionBusy(true);
        try {
            const blob = await downloadChatSummaryJob(hubAccessToken, job.id);
            const compactStart = String(job.from_date || "").replace(/-/g, "");
            const compactEnd = String(job.to_date || "").replace(/-/g, "");
            const fileBase = `${job.target_label}聊天室总结${compactStart}${compactEnd}`.replace(/[\\/:*?"<>|]/g, "_");
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${fileBase || "chat-summary"}.docx`;
            anchor.rel = "noopener noreferrer";
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
        } catch (error) {
            setSummaryJobsError(error instanceof Error ? error.message : t("layout.notebook.summaryDownloadFailed", "Failed to download summary."));
        } finally {
            setSummaryJobActionBusy(false);
        }
    }, [hubAccessToken, t]);

    useEffect(() => {
        if (activeTab !== "notebook" || notebookSidebarMode !== "chatSummary") return;
        void loadSummaryJobs();
    }, [activeTab, notebookSidebarMode, loadSummaryJobs]);

    useEffect(() => {
        if (activeTab !== "notebook" || notebookSidebarMode !== "chatSummary") return;
        if (!hasProcessingSummaryJob) return;
        const timer = window.setInterval(() => {
            void loadSummaryJobs();
        }, 2500);
        return () => window.clearInterval(timer);
    }, [activeTab, hasProcessingSummaryJob, loadSummaryJobs, notebookSidebarMode]);

    const openRoomWithOptionalJump = useCallback((roomId: string, eventId?: string | null) => {
        setActiveTab("chat");
        setActiveRoomId(roomId);
        setMobileView("detail");
        setChatGlobalSearchOpen(false);
        if (eventId) setJumpToEventId(eventId);
    }, []);

    const onSelectSearchPerson = useCallback(async (hit: ChatSearchPersonHit) => {
        if (!matrixClient || !hit.matrix_user_id) {
            setChatGlobalSearchError("無法定位該使用者聊天室");
            return;
        }
        try {
            const roomId = await getOrCreateDirectRoom(matrixClient, hit.matrix_user_id);
            openRoomWithOptionalJump(roomId);
        } catch (error) {
            setChatGlobalSearchError(error instanceof Error ? error.message : "無法打開聊天室");
        }
    }, [matrixClient, openRoomWithOptionalJump]);

    const onSelectSearchMessage = useCallback((hit: ChatSearchMessageHit) => {
        openRoomWithOptionalJump(hit.room_id, hit.event_id);
    }, [openRoomWithOptionalJump]);

    const onHideActiveRoom = async (): Promise<void> => {
        if (!matrixClient || !activeRoomId) return;
        const room = matrixClient.getRoom(activeRoomId);
        if (!room) return;
        try {
            const accountData = matrixClient.getAccountData(EventType.Direct);
            const directContent = (accountData?.getContent() ?? {}) as Record<string, string[]>;
            const directRoomIds = new Set<string>();
            Object.values(directContent).forEach((roomIds) => {
                roomIds.forEach((roomId) => directRoomIds.add(roomId));
            });

            if (directRoomIds.has(activeRoomId)) {
                const currentUserId = matrixCredentials?.user_id ?? null;
                const otherMember = room.getJoinedMembers().find((member) => member.userId !== currentUserId);
                const directPartnerId =
                    otherMember?.userId ??
                    Object.entries(directContent).find(([, roomIds]) => roomIds.includes(activeRoomId))?.[0] ??
                    null;
                if (!directPartnerId) return;
                await hideDirectRoom(matrixClient, directPartnerId, activeRoomId);
                if (room.name?.startsWith(DEPRECATED_DM_PREFIX)) {
                    await matrixClient.leave(activeRoomId);
                }
            } else if (!room.isSpaceRoom()) {
                await matrixClient.leave(activeRoomId);
            }
            setPinnedRoomIds((prev) => prev.filter((roomId) => roomId !== activeRoomId));
            setActiveRoomId(null);
            setMobileView("list");
        } catch {
            // ignore hide failures
        }
    };

    const onLeaveActiveRoom = async (): Promise<void> => {
        if (!matrixClient || !activeRoomId) return;
        const room = matrixClient.getRoom(activeRoomId);
        if (!room || room.isSpaceRoom()) return;
        try {
            await matrixClient.leave(activeRoomId);
            setPinnedRoomIds((prev) => prev.filter((roomId) => roomId !== activeRoomId));
            setActiveRoomId(null);
            setMobileView("list");
        } catch {
            // ignore leave failures
        }
    };

    const onTogglePinActiveRoom = (): void => {
        if (!activeRoomId) return;
        setPinnedRoomIds((prev) => {
            if (prev.includes(activeRoomId)) {
                return prev.filter((roomId) => roomId !== activeRoomId);
            }
            return [activeRoomId, ...prev];
        });
    };

    const isActiveRoomPinned = activeRoomId ? pinnedRoomIds.includes(activeRoomId) : false;

    const getLocalPart = (value: string | null | undefined): string => {
        if (!value) return "";
        const trimmed = value.startsWith("@") ? value.slice(1) : value;
        return trimmed.split(":")[0] || "";
    };

    const getContactLabel = (contact: ContactSummary | null): string => {
        if (!contact) return t("layout.contactFallback");
        const localpart = contact.userLocalId || getLocalPart(contact.matrixUserId);
        if (localpart && contact.displayName && contact.displayName !== localpart) {
            return `${localpart} (${contact.displayName})`;
        }
        return localpart || contact.displayName || t("layout.contactFallback");
    };

    const getGenderLabel = (value: string | null): string => {
        if (!value) return t("common.placeholder");
        if (value === "male") return t("profile.gender.male");
        if (value === "female") return t("profile.gender.female");
        return value;
    };

    const getLanguageLabel = (contact: ContactSummary | null): string => {
        if (!contact) return t("common.placeholder");
        const locale = contact.translationLocale || contact.locale;
        if (!locale) return t("common.placeholder");
        const match = translationLanguageOptions.find((option) => option.value === locale);
        return match?.label ?? locale;
    };

    const hubTokenExpired = hubSessionExpiresAt ? hubSessionExpiresAt * 1000 < Date.now() : false;
    const useHubToken = Boolean(hubAccessToken) && !hubTokenExpired;
    const actionToken = useHubToken ? hubAccessToken : matrixAccessToken;
    const actionHsUrl = useHubToken ? null : matrixHsUrl;
    const matrixHost = (() => {
        if (!matrixHsUrl) return null;
        try {
            return new URL(matrixHsUrl).host;
        } catch {
            return null;
        }
    })();

    const resolveActiveContactMatrixUserId = useCallback((): string | null => {
        if (!activeContact) return null;
        return activeContact.matrixUserId ||
            (activeContact.userLocalId && matrixHost ? `@${activeContact.userLocalId}:${matrixHost}` : null);
    }, [activeContact, matrixHost]);

    const sharedContactRooms = useMemo<SharedContactRoomEntry[]>(() => {
        if (!matrixClient || !activeContact) return [];
        const matrixUserId = resolveActiveContactMatrixUserId();
        if (!matrixUserId) return [];
        return matrixClient
            .getRooms()
            .filter((room) => {
                if (room.getMyMembership() !== "join") return false;
                if (room.isSpaceRoom()) return false;
                if (room.name?.startsWith(DEPRECATED_DM_PREFIX)) return false;
                const membership = room.getMember(matrixUserId)?.membership;
                return membership === "join" || membership === "invite";
            })
            .map((room) => {
                const memberCount = new Set(
                    room
                        .getMembers()
                        .filter((member) => member.membership === "join" || member.membership === "invite")
                        .map((member) => member.userId),
                ).size;
                return {
                    roomId: room.roomId,
                    displayName: room.name || room.roomId,
                    memberCount: memberCount || room.getJoinedMembers().length || 2,
                    lastActive: room.getLastActiveTimestamp(),
                };
            })
            .sort((a, b) => b.lastActive - a.lastActive);
    }, [activeContact, matrixClient, resolveActiveContactMatrixUserId]);

    useEffect(() => {
        if (sharedContactRooms.length === 0) {
            setSelectedSharedRoomId(null);
            return;
        }
        setSelectedSharedRoomId((prev) => {
            if (prev && sharedContactRooms.some((room) => room.roomId === prev)) return prev;
            return sharedContactRooms[0].roomId;
        });
    }, [sharedContactRooms]);

    const onStartContactChat = async (): Promise<void> => {
        if (!selectedSharedRoomId) {
            setContactRoomActionError(t("layout.sharedRoomsSelectFirst"));
            return;
        }
        setContactRoomActionError(null);
        setActiveRoomId(selectedSharedRoomId);
        setActiveTab("chat");
        setMobileView("detail");
    };

    const onCreateContactRoom = async (): Promise<void> => {
        if (!matrixClient || !activeContact) return;
        const currentUserId = matrixClient.getUserId();
        if (!currentUserId) {
            setContactRoomActionError(t("layout.sharedRoomsCreateFailed"));
            return;
        }
        const matrixUserId = resolveActiveContactMatrixUserId();
        if (!matrixUserId) {
            setContactRoomActionError(t("layout.sharedRoomsNoMatrixId"));
            return;
        }
        setContactRoomActionError(null);
        setCreatingContactRoom(true);
        try {
            const result = await matrixClient.createRoom({
                invite: [matrixUserId],
                preset: Preset.PrivateChat,
                power_level_content_override: {
                    users: {
                        [currentUserId]: 100,
                        [matrixUserId]: 100,
                    },
                    users_default: 0,
                    events_default: 0,
                    state_default: 50,
                    ban: 50,
                    kick: 50,
                    redact: 50,
                    invite: 50,
                },
            });
            setSelectedSharedRoomId(result.room_id);
            setActiveRoomId(result.room_id);
            setActiveTab("chat");
            setMobileView("detail");
        } catch (error) {
            setContactRoomActionError(error instanceof Error ? error.message : t("layout.sharedRoomsCreateFailed"));
        } finally {
            setCreatingContactRoom(false);
        }
    };

    const onRemoveActiveContact = async (): Promise<void> => {
        if (!actionToken || !activeContact) return;
        try {
            await removeContact(actionToken, activeContact.id, actionHsUrl);
            setActiveContact(null);
            setSelectedSharedRoomId(null);
            setShowContactMenu(false);
            setShowRemoveContactConfirm(false);
            setContactsRefreshToken((prev) => prev + 1);
        } catch {
            setShowContactMenu(false);
            setShowRemoveContactConfirm(false);
        }
    };

    const myFileLibrary = useMemo<FileLibraryItem[]>(() => {
        if (!matrixClient || !matrixCredentials?.user_id) return [];
        void fileLibraryTick;
        const me = matrixCredentials.user_id;
        const rows: FileLibraryItem[] = [];
        matrixClient.getRooms().forEach((room) => {
            if (room.getMyMembership() !== "join" || room.isSpaceRoom()) return;
            const events = getLoadedRoomEvents(room);
            events.forEach((event) => {
                if (event.getType() !== EventType.RoomMessage) return;
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
    }, [matrixClient, matrixCredentials?.user_id, fileLibraryTick]);

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

    useEffect(() => {
        if (activeTab !== "files") return;
        if (selectedFileRoomId && filteredRoomSummaryList.some((item) => item.roomId === selectedFileRoomId)) return;
        setSelectedFileRoomId(filteredRoomSummaryList[0]?.roomId ?? null);
    }, [activeTab, filteredRoomSummaryList, selectedFileRoomId]);

    useEffect(() => {
        if (activeTab !== "files") return;
        traceEvent("files.room_filter_changed", {
            roomSearch: debouncedFileRoomSearch,
            selectedRoomId: selectedFileRoomId,
            roomCount: filteredRoomSummaryList.length,
        });
    }, [activeTab, debouncedFileRoomSearch, selectedFileRoomId, filteredRoomSummaryList.length]);

    useEffect(() => {
        if (activeTab !== "files" || !selectedFileRoomId) return;
        traceEvent("files.list_filter_changed", {
            roomId: selectedFileRoomId,
            keyword: debouncedFileListSearch,
            typeFilter: fileListTypeFilter,
            visibleCount: visibleSelectedRoomFiles.length,
        });
    }, [activeTab, selectedFileRoomId, debouncedFileListSearch, fileListTypeFilter, visibleSelectedRoomFiles.length]);

    useEffect(() => {
        setFileListPage(1);
    }, [selectedFileRoomId, debouncedFileListSearch, fileListTypeFilter]);

    useEffect(() => {
        if (!matrixClient || activeTab !== "files" || !selectedFileRoomId) return;
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
    }, [activeTab, matrixClient, selectedFileRoomId]);

    useEffect(() => {
        setSelectedFileIds((prev) => prev.filter((eventId) => selectedRoomFiles.some((item) => item.eventId === eventId)));
    }, [selectedRoomFiles]);

    const getHttpFileUrl = (item: FileLibraryItem): string | null => {
        if (!matrixClient) return null;
        return matrixClient.mxcUrlToHttp(item.mxcUrl);
    };

    const isFileSelected = (eventId: string): boolean => selectedFileIds.includes(eventId);

    const toggleFileSelection = (eventId: string): void => {
        setSelectedFileIds((prev) => (prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]));
    };

    const onOpenFileItem = (item: FileLibraryItem): void => {
        const url = getHttpFileUrl(item);
        if (!url) return;
        traceEvent("files.download", {
            roomId: item.roomId,
            eventId: item.eventId,
            fileName: item.body,
        });
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = item.body || "file";
        anchor.rel = "noopener noreferrer";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
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
        setPreviewZoom(1);
        setPreviewOffset({ x: 0, y: 0 });
        setFilePreview({ url, type: previewType, name: item.body });
    };

    const onJumpToFileMessage = (item: FileLibraryItem): void => {
        traceEvent("files.jump_to_message", {
            roomId: item.roomId,
            eventId: item.eventId,
            fileName: item.body,
        });
        setActiveRoomId(item.roomId);
        setJumpToEventId(item.eventId);
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
            await matrixClient.sendEvent(item.roomId, EventType.RoomMessage, {
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
            const mapped = mapMediaActionError(error);
            setFileActionError(mapActionErrorToMessage(t, error, "layout.fileDeleteFailed"));
            traceEvent("files.delete_failed", {
                roomId: item.roomId,
                eventId: item.eventId,
                reason: mapped,
            });
        } finally {
            setFileDeletingEventId(null);
        }
    };

    const onDeleteBatchFiles = async (): Promise<void> => {
        if (fileBatchDeleting) return;
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
        let mappedError: "STORAGE_QUOTA_EXCEEDED" | "NO_PERMISSION" | "GENERIC" | null = null;
        for (let i = 0; i < targets.length; i += 1) {
            const item = targets[i];
            try {
                await matrixClient?.redactEvent(item.roomId, item.eventId);
                if (matrixCredentials?.hs_url && matrixCredentials.access_token) {
                    await cleanupUploadedMedia(matrixCredentials.hs_url, matrixCredentials.access_token, item.mxcUrl);
                }
                const selfLabel = getLocalPart(matrixCredentials?.user_id) || matrixCredentials?.user_id || "user";
                await matrixClient?.sendEvent(item.roomId, EventType.RoomMessage, {
                    msgtype: "m.notice",
                    body: t("chat.fileRevokedNotice", { name: selfLabel }),
                } as never);
            } catch (error) {
                failed += 1;
                if (!mappedError) {
                    mappedError = mapMediaActionError(error);
                }
            } finally {
                setFileBatchDeleteProgress({ done: i + 1, total: targets.length });
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
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-100 font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 lg:flex-row">
            {/* 1. Leftmost Nav Bar (w-16, bg-gray-900) */}
            <nav className="w-full bg-gray-900 flex items-center justify-between px-4 py-2 flex-shrink-0 z-20 dark:bg-slate-900 lg:w-16 lg:flex-col lg:justify-start lg:py-4">
                {/* App Logo Placeholder */}
                <div className="relative lg:mb-8">
                    <button
                        ref={accountButtonRef}
                        type="button"
                        onClick={() => setShowAccountMenu((prev) => !prev)}
                        className="w-10 h-10 bg-[#2F5C56] rounded-xl overflow-hidden flex items-center justify-center text-white font-bold text-sm"
                        aria-label={t("layout.accountMenu")}
                    >
                        {accountAvatarUrl ? (
                            <img src={accountAvatarUrl} alt={accountId} className="h-full w-full object-cover" />
                        ) : (
                            accountInitial
                        )}
                    </button>
                    {showAccountMenu && (
                        <div
                            ref={accountMenuRef}
                            className="absolute left-0 z-30 mt-2 w-36 rounded-lg border border-gray-200 bg-white py-2 text-sm shadow-2xl ring-1 ring-black/5 dark:border-slate-800 dark:bg-slate-900"
                        >
                            <div className="border-b border-gray-100 px-3 pb-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                                {accountId}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setActiveTab("account");
                                    setShowAccountMenu(false);
                                }}
                                className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("layout.accountSettings")}
                            </button>
                        </div>
                    )}
                </div>

                {/* Nav Items */}
                <div className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-700/70 bg-slate-800/60 px-1 py-1 sm:gap-2 lg:w-full lg:flex-col lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
                    <NavBarItem
                        icon={UserGroupIcon}
                        active={activeTab === "contacts"}
                        badgeCount={inviteBadgeCount}
                        onClick={() => {
                            setMobileView("list");
                            setActiveTab("contacts");
                        }}
                        className="order-1 lg:order-none"
                    />
                    <NavBarItem
                        icon={ChatBubbleLeftRightIcon}
                        active={activeTab === "chat"}
                        badgeCount={unreadBadgeCount}
                        onClick={() => {
                            setMobileView("list");
                            setActiveTab("chat");
                        }}
                        className="order-2 lg:order-none"
                    />
                    {notebookCapabilityState.canUseNotebookBasic && (
                        <NavBarItem
                            icon={BookOpenIcon}
                            active={activeTab === "notebook"}
                            onClick={() => {
                                setMobileView("list");
                                setActiveTab("notebook");
                            }}
                            className="order-3 lg:order-none"
                        />
                    )}
                    <NavBarItem
                        icon={FolderIcon}
                        active={activeTab === "files"}
                        onClick={() => {
                            setMobileView("list");
                            setActiveTab("files");
                        }}
                        className="order-4 lg:order-none"
                    />
                    <NavBarItem
                        icon={Cog6ToothIcon}
                        active={activeTab === "settings"}
                        onClick={() => {
                            setActiveTab("settings");
                            setSettingsDetail("none");
                            setMobileView("list");
                        }}
                        className="order-5 lg:order-none lg:hidden"
                    />
                </div>

                {/* Bottom Actions */}
                <div className="hidden w-full items-center justify-end gap-2 lg:mb-4 lg:flex lg:flex-col">
                    <button
                        type="button"
                        onClick={() => {
                            setActiveTab("settings");
                            setSettingsDetail("none");
                            setMobileView("list");
                        }}
                        className={`w-full h-16 flex items-center justify-center cursor-pointer transition-colors ${activeTab === "settings"
                            ? "text-[#2F5C56] bg-gray-800"
                            : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                            }`}
                        aria-label={t("layout.openSettings")}
                    >
                        <Cog6ToothIcon className="w-7 h-7" />
                    </button>
                </div>
            </nav>

            {/* 2. List Panel (w-80, bg-white) */}
            <aside
                className={`min-h-0 w-full flex-1 lg:flex-none bg-white border-r border-gray-200 flex flex-col flex-shrink-0 z-10 shadow-sm dark:bg-slate-900 dark:border-slate-800 lg:w-80 ${mobileView === "detail" ? "hidden lg:flex" : "flex"
                    }`}
            >
                {activeTab === "settings" ? (
                    <>
                        <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {t("layout.settings")}
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar p-4 space-y-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setSettingsDetail("none");
                                }}
                                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("layout.tickets")}
                            </button>
                            <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-800">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm text-slate-700 dark:text-slate-100">
                                        {t("layout.appearance")}
                                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                                            {themeMode === "dark" ? t("layout.dark") : t("layout.light")}
                                        </span>
                                    </div>
                                    <div className="flex items-center rounded-full border border-gray-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                        <button
                                            type="button"
                                            onClick={() => setThemeMode("light")}
                                            className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${themeMode === "light"
                                                ? "bg-emerald-500 text-white"
                                                : "text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                                }`}
                                            aria-label={t("layout.light")}
                                        >
                                            <span aria-hidden="true">☀</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setThemeMode("dark")}
                                            className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${themeMode === "dark"
                                                ? "bg-emerald-500 text-white"
                                                : "text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                                }`}
                                            aria-label={t("layout.dark")}
                                        >
                                            <span aria-hidden="true">🌙</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-800">
                                <div className="text-sm text-slate-700 dark:text-slate-100 mb-2">
                                    {t("layout.displayLanguage")}
                                </div>
                                <select
                                    value={displayLanguage}
                                    onChange={(event) => void handleDisplayLanguageChange(event.target.value)}
                                    className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                >
                                    {displayLangOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setSettingsDetail("chat-language");
                                    setPendingChatReceiveLanguage(chatReceiveLanguage);
                                    setMobileView("detail");
                                }}
                                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("layout.chatReceiveLanguage")}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setSettingsDetail("translation-default");
                                    setMobileView("detail");
                                }}
                                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("layout.translationDefaultContent")}
                            </button>
                            <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-800">
                                <div className="mb-2 text-sm text-slate-700 dark:text-slate-100">
                                    {t("layout.notificationSound")}
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={notificationSoundMode}
                                        onChange={(event) => {
                                            const next = event.target.value as NotificationSoundMode;
                                            setNotificationSoundMode(next);
                                            if (next !== "off") {
                                                playNotificationSound(next);
                                            }
                                        }}
                                        className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    >
                                        <option value="off">{t("layout.notificationSoundOff")}</option>
                                        <option value="classic">{t("layout.notificationSoundClassic")}</option>
                                        <option value="soft">{t("layout.notificationSoundSoft")}</option>
                                        <option value="chime">{t("layout.notificationSoundChime")}</option>
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (notificationSoundMode === "off") return;
                                            playNotificationSound(notificationSoundMode);
                                        }}
                                        disabled={notificationSoundMode === "off"}
                                        className="rounded-md border border-gray-200 px-3 py-1 text-xs text-slate-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                                    >
                                        {t("layout.notificationSoundPreview")}
                                    </button>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onLogout}
                                className="w-full text-left rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-slate-800"
                            >
                                {t("layout.logoutAccount")}
                            </button>
                        </div>
                    </>
                ) : activeTab === "account" ? (
                    <>
                        <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {t("layout.accountSettings")}
                            </div>
                        </div>
                        <div className="p-4 space-y-3">
                            <button
                                type="button"
                                onClick={() => avatarUploadInputRef.current?.click()}
                                disabled={avatarUploading}
                                className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {avatarUploading ? t("common.loading") : t("layout.uploadAvatar")}
                            </button>
                            {avatarUploadFeedback && (
                                <div
                                    className={`text-xs ${avatarUploadFeedback.includes("failed")
                                            ? "text-rose-500"
                                            : "text-emerald-600 dark:text-emerald-300"
                                        }`}
                                >
                                    {avatarUploadFeedback}
                                </div>
                            )}
                            <input
                                ref={avatarUploadInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(event) => {
                                    void onUploadAvatar(event);
                                }}
                            />
                            <button
                                type="button"
                                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("layout.changePassword")}
                            </button>
                            <button
                                type="button"
                                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("layout.changeName")}
                            </button>
                        </div>
                    </>
                ) : activeTab === "notebook" ? (
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
                            setMobileView("detail");
                        }}
                        onCreate={() => {
                            void notebookModule.createItem();
                            setMobileView("detail");
                        }}
                        busy={notebookModule.actionBusy}
                        hasMore={notebookModule.hasMore}
                        loadingMore={notebookModule.loadingMore}
                        onLoadMore={() => {
                            void notebookModule.loadMore();
                        }}
                        showCompanyFilter={userType !== "client"}
                        mode={notebookSidebarMode}
                        onModeChange={setNotebookSidebarMode}
                        summaryQuery={summarySearchQuery}
                        onSummaryQueryChange={setSummarySearchQuery}
                        onSummarySearchNow={(value) => {
                            void runSummarySearch({ forceQuery: value });
                        }}
                        summaryLoading={summarySearchLoading}
                        summaryError={summarySearchError}
                        summaryPeopleResults={summaryPeopleResults}
                        summaryRoomResults={summaryRoomResults}
                        summarySelectedTarget={summarySelectedTarget}
                        onSummarySelectTarget={setSummarySelectedTarget}
                        summaryStartDate={summaryStartDate}
                        summaryEndDate={summaryEndDate}
                        onSummaryStartDateChange={setSummaryStartDate}
                        onSummaryEndDateChange={setSummaryEndDate}
                        onSummaryConfirm={() => {
                            void loadSummaryChatContent();
                        }}
                        summaryConfirmLoading={summaryContentLoading}
                    />
                ) : activeTab === "files" ? (
                    <>
                        <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {t("layout.filesTitle")}
                            </div>
                        </div>
                        <div className="p-3">
                            <div className="bg-gray-100 rounded-lg px-3 py-2 flex items-center gap-2 dark:bg-slate-800">
                                <svg
                                    className="w-5 h-5 text-gray-400 dark:text-slate-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                    />
                                </svg>
                                <input
                                    type="text"
                                    value={fileRoomSearch}
                                    onChange={(event) => setFileRoomSearch(event.target.value)}
                                    placeholder={t("layout.filesRoomSearchPlaceholder")}
                                    className="bg-transparent border-none outline-none text-sm w-full text-slate-700 placeholder-gray-400 dark:text-slate-200 dark:placeholder-slate-500"
                                />
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar px-3 pb-3 space-y-2">
                            {filteredRoomSummaryList.length === 0 ? (
                                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                                    {t("layout.filesRoomsEmpty")}
                                </div>
                            ) : (
                                filteredRoomSummaryList.map((room) => {
                                    const active = room.roomId === selectedFileRoomId;
                                    const sizeText =
                                        room.unknownSizeCount > 0
                                            ? `${formatBytesToMb(room.totalKnownBytes)} MB+`
                                            : `${formatBytesToMb(room.totalKnownBytes)} MB`;
                                    return (
                                        <button
                                            key={room.roomId}
                                            type="button"
                                            onClick={() => {
                                                setSelectedFileRoomId(room.roomId);
                                                setMobileView("detail");
                                            }}
                                            className={`w-full rounded-xl border px-3 py-2 text-left ${active
                                                ? "border-emerald-400 bg-emerald-50/70 dark:bg-emerald-900/20"
                                                : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800"
                                                }`}
                                        >
                                            <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-100">
                                                {room.roomName} ({room.attachmentCount})
                                            </div>
                                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                {t("layout.filesRoomSizeLabel", { size: sizeText })}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        {/* Header */}
                        <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                            <div className="flex items-center gap-3 min-w-0">
                                {accountAvatarUrl ? (
                                    <img src={accountAvatarUrl} alt={accountId} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                                ) : (
                                    <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
                                )}
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                        {accountId}
                                    </div>
                                    <div className="text-xs text-slate-500 truncate dark:text-slate-400">{accountSubtitle}</div>
                                </div>
                            </div>
                        </div>

                        {/* Search Bar */}
                        <div ref={chatGlobalSearchPanelRef} className="p-3 relative">
                            <div className="bg-gray-100 rounded-lg px-3 py-2 flex items-center gap-2 dark:bg-slate-800">
                                <svg
                                    className="w-5 h-5 text-gray-400 dark:text-slate-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                    />
                                </svg>
                                <input
                                    type="text"
                                    value={chatGlobalSearchQuery}
                                    onFocus={() => setChatGlobalSearchOpen(true)}
                                    onChange={(event) => {
                                        setChatGlobalSearchQuery(event.target.value);
                                        setChatGlobalSearchOpen(true);
                                        if (!event.target.value.trim()) {
                                            setChatGlobalSearchResult(null);
                                            setChatGlobalSearchCursor(null);
                                            setChatGlobalSearchError(null);
                                        }
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            void runChatGlobalSearch({ forceQuery: chatGlobalSearchQuery });
                                        }
                                        if (event.key === "Escape") {
                                            setChatGlobalSearchOpen(false);
                                        }
                                    }}
                                    placeholder={t("layout.searchPlaceholder")}
                                    className="bg-transparent border-none outline-none text-sm w-full text-slate-700 placeholder-gray-400 dark:text-slate-200 dark:placeholder-slate-500"
                                />
                                {activeTab === "chat" && (
                                    <button
                                        type="button"
                                        onClick={() => setShowCreateRoomModal(true)}
                                        className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-300"
                                    >
                                        {t("layout.createRoomLabel", t("layout.groupChat", "New room"))}
                                    </button>
                                )}
                            </div>
                            {chatGlobalSearchOpen && (
                                <div className="absolute left-3 right-3 top-[58px] z-30 max-h-[55vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                                    {chatGlobalSearchLoading && (
                                        <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-300">搜尋中...</div>
                                    )}
                                    {chatGlobalSearchError && (
                                        <div className="px-3 py-3 text-xs text-rose-600 dark:text-rose-300">{chatGlobalSearchError}</div>
                                    )}
                                    {!chatGlobalSearchLoading && !chatGlobalSearchError && chatGlobalSearchQuery.trim() && (
                                        <>
                                            {chatGlobalSearchResult?.people_hits?.length ? (
                                                <div className="border-b border-gray-100 px-3 py-2 dark:border-slate-800">
                                                    <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">人員</div>
                                                    <div className="space-y-1">
                                                        {chatGlobalSearchResult.people_hits.map((hit) => (
                                                            <button
                                                                key={`${hit.profile_id}-${hit.matrix_user_id || ""}`}
                                                                type="button"
                                                                onClick={() => {
                                                                    void onSelectSearchPerson(hit);
                                                                }}
                                                                className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                                                            >
                                                                <div className="font-semibold text-slate-700 dark:text-slate-100">{hit.display_name || hit.user_local_id || hit.matrix_user_id || "Unknown"}</div>
                                                                <div className="text-slate-500 dark:text-slate-400">
                                                                    {formatMatrixUserLocalId(hit.matrix_user_id) || hit.company_name || ""}
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}
                                            {chatGlobalSearchResult?.message_hits?.length ? (
                                                <div className="px-3 py-2">
                                                    <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">消息</div>
                                                    <div className="space-y-1">
                                                        {chatGlobalSearchResult.message_hits.map((hit) => (
                                                            <button
                                                                key={`${hit.room_id}-${hit.event_id}`}
                                                                type="button"
                                                                onClick={() => onSelectSearchMessage(hit)}
                                                                className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                                                            >
                                                                <div className="line-clamp-2 font-semibold text-slate-700 dark:text-slate-100">{hit.preview || "(no preview)"}</div>
                                                                <div className="text-slate-500 dark:text-slate-400">
                                                                    {`${formatMatrixUserLocalId(hit.sender) || ""}${hit.ts ? ` · ${new Date(hit.ts).toLocaleString()}` : ""}`}
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}
                                            {!chatGlobalSearchResult?.people_hits?.length && !chatGlobalSearchResult?.message_hits?.length && (
                                                <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-300">沒有搜尋結果</div>
                                            )}
                                            {chatGlobalSearchCursor && (
                                                <div className="border-t border-gray-100 px-3 py-2 dark:border-slate-800">
                                                    <button
                                                        type="button"
                                                        onClick={() => void runChatGlobalSearch({ forceQuery: chatGlobalSearchQuery, cursor: chatGlobalSearchCursor, append: true })}
                                                        disabled={chatGlobalSearchLoading}
                                                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                                                    >
                                                        載入更多
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Room List Content (Placeholder) */}
                        <RoomList
                            client={matrixClient}
                            hubAccessToken={hubAccessToken}
                            matrixAccessToken={matrixAccessToken}
                            matrixHsUrl={matrixHsUrl}
                            userType={userType}
                            hubSessionExpiresAt={hubSessionExpiresAt}
                            activeRoomId={activeRoomId}
                            onSelectRoom={(roomId) => {
                                setActiveRoomId(roomId);
                                setMobileView("detail");
                            }}
                            onInviteBadgeChange={setInviteBadgeCount}
                            onUnreadBadgeChange={setUnreadBadgeCount}
                            view={activeTab === "contacts" ? "contacts" : "chat"}
                            onSelectContact={(contact) => {
                                setActiveContact(contact);
                                setMobileView("detail");
                            }}
                            activeContactId={activeContact?.id ?? null}
                            contactsRefreshToken={contactsRefreshToken}
                            pinnedRoomIds={pinnedRoomIds}
                            enableContactPolling
                            notificationSoundMode={notificationSoundMode}
                        />
                    </>
                )}
            </aside>

            {/* 3. Chat Area (Flex-grow, bg-[#F2F4F7]) */}
            <main
                className={`flex-1 min-h-0 flex flex-col bg-[#F2F4F7] relative min-w-0 dark:bg-slate-950 ${mobileView === "list" ? "hidden lg:flex" : "flex"
                    }`}
            >
                {capabilityError && (
                    <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                        <div>{capabilityError}</div>
                        <div className="mt-2 flex gap-2">
                            <button
                                type="button"
                                onClick={retryNotebookCapability}
                                className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:text-rose-200 dark:hover:bg-rose-900/40"
                            >
                                {t("layout.notebook.retry")}
                            </button>
                            <button
                                type="button"
                                onClick={onLogout}
                                className="rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700"
                            >
                                {t("layout.notebook.relogin")}
                            </button>
                        </div>
                    </div>
                )}
                {/* Render nested routes (ChatRoom) here */}
                {activeTab === "contacts" ? (
                    <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar flex flex-col bg-white dark:bg-slate-900">
                        {activeContact ? (
                            <div className="flex-1 min-h-0 flex flex-col">
                                <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-slate-800 sm:px-8 sm:py-6">
                                    <div className="flex items-center gap-3 sm:gap-4">
                                        <button
                                            type="button"
                                            onClick={() => setMobileView("list")}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                                            aria-label={t("layout.backToList")}
                                        >
                                            &lt;
                                        </button>
                                        {(() => {
                                            const contactAvatarUrl = getContactAvatarUrl(activeContact.matrixUserId);
                                            if (contactAvatarUrl) {
                                                return (
                                                    <img
                                                        src={contactAvatarUrl}
                                                        alt={getContactLabel(activeContact)}
                                                        className="w-16 h-16 rounded-full object-cover"
                                                    />
                                                );
                                            }
                                            return (
                                                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-semibold dark:bg-emerald-900/40 dark:text-emerald-200">
                                                    {getContactLabel(activeContact).charAt(0).toUpperCase()}
                                                </div>
                                            );
                                        })()}
                                        <div>
                                            <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">
                                                {getContactLabel(activeContact)}
                                            </div>
                                            <div className="text-sm text-slate-500 dark:text-slate-400">
                                                {activeContact.companyName || t("common.placeholder")}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="relative">
                                        <button
                                            ref={contactMenuButtonRef}
                                            type="button"
                                            onClick={() => setShowContactMenu((prev) => !prev)}
                                            className="h-10 w-10 rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                            aria-label={t("layout.contactActions")}
                                        >
                                            ...
                                        </button>
                                        {showContactMenu && (
                                            <div
                                                ref={contactMenuRef}
                                                className="absolute right-0 mt-2 w-40 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-slate-800 dark:bg-slate-900"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setShowContactMenu(false);
                                                        setShowRemoveContactConfirm(true);
                                                    }}
                                                    className="w-full px-3 py-2 text-left text-rose-500 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-slate-800"
                                                >
                                                    {t("layout.removeContact")}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {showRemoveContactConfirm && (
                                    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                                        <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                                            <div className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
                                                {t("layout.removeContactConfirm")}
                                            </div>
                                            <div className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                                                {getContactLabel(activeContact)}
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowRemoveContactConfirm(false)}
                                                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                                >
                                                    {t("common.cancel")}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void onRemoveActiveContact()}
                                                    className="flex-1 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-600"
                                                >
                                                    {t("common.confirm")}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="flex-1 px-6 py-4 sm:px-8">
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="flex items-center gap-2">
                                                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                                    {t("layout.details.id")}
                                                </div>
                                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                    {activeContact.userLocalId || getLocalPart(activeContact.matrixUserId) || t("common.placeholder")}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="flex items-center gap-2">
                                                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                                    {t("layout.details.name")}
                                                </div>
                                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                    {activeContact.displayName || t("common.placeholder")}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="flex items-center gap-2">
                                                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                                    {t("layout.details.gender")}
                                                </div>
                                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                    {getGenderLabel(activeContact.gender)}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="flex items-center gap-2">
                                                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                                    {t("layout.details.country")}
                                                </div>
                                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                    {activeContact.country || t("common.placeholder")}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="flex items-center gap-2">
                                                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                                    {t("layout.details.language")}
                                                </div>
                                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                    {getLanguageLabel(activeContact)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950">
                                        <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                            {t("layout.sharedRoomsTitle")}
                                        </div>
                                        <div className="mt-2 space-y-1.5">
                                            {sharedContactRooms.length > 0 ? (
                                                sharedContactRooms.map((room) => {
                                                    const selected = room.roomId === selectedSharedRoomId;
                                                    return (
                                                        <button
                                                            key={room.roomId}
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedSharedRoomId(room.roomId);
                                                                setContactRoomActionError(null);
                                                            }}
                                                            className={`w-full rounded-lg border px-3 py-1.5 text-left transition ${selected
                                                                ? "border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-900/30 dark:text-emerald-100"
                                                                : "border-gray-200 bg-white text-slate-700 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                                                }`}
                                                        >
                                                            <div className="text-sm font-semibold leading-5">{`${room.displayName} (${room.memberCount})`}</div>
                                                        </button>
                                                    );
                                                })
                                            ) : (
                                                <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                                    {t("layout.sharedRoomsEmpty")}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="sticky bottom-0 px-6 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-8 lg:static lg:pt-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-gray-100 dark:border-slate-800 lg:border-t-0">
                                    {contactRoomActionError ? (
                                        <div className="mb-2 text-xs text-rose-500 dark:text-rose-300">{contactRoomActionError}</div>
                                    ) : null}
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void onStartContactChat()}
                                            disabled={!selectedSharedRoomId}
                                            className="inline-flex items-center justify-center rounded-xl bg-[#2F5C56] px-6 py-3 text-sm font-semibold text-white shadow-md enabled:hover:bg-[#244a45] disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-emerald-500 dark:enabled:hover:bg-emerald-400 dark:disabled:bg-slate-700"
                                        >
                                            {t("layout.chatAction")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void onCreateContactRoom()}
                                            disabled={creatingContactRoom}
                                            className="inline-flex items-center justify-center rounded-xl border border-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-700 enabled:hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-400 dark:text-emerald-300 dark:enabled:hover:bg-emerald-900/20"
                                        >
                                            {creatingContactRoom ? t("layout.creatingRoomAction") : t("layout.createRoomAction")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                {t("layout.selectContact")}
                            </div>
                        )}
                    </div>
                ) : activeTab === "files" ? (
                    <div className="flex-1 flex flex-col bg-white dark:bg-slate-900">
                        {!selectedRoomSummary ? (
                            <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                {t("layout.fileNoRoomSelected")}
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col">
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
                                        <div className="text-base font-semibold text-slate-800 truncate dark:text-slate-100">
                                            {selectedRoomSummary.roomName}
                                        </div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">
                                            {t("layout.filesCountLabel", { count: selectedRoomSummary.attachmentCount })}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowFileToolbarMenu((prev) => !prev)}
                                        className="h-8 rounded-lg border border-gray-200 px-2 text-xs text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                    >
                                        ...
                                    </button>
                                </div>
                                {showFileToolbarMenu && (
                                    <div className="mx-6 mt-2 w-36 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                                        <button
                                            type="button"
                                            disabled={fileBatchDeleting}
                                            className="w-full px-3 py-1.5 text-left text-slate-600 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
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
                                    <div className="mx-6 mt-3 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
                                        <span>
                                            {fileBatchDeleting
                                                ? t("layout.fileBatchDeletingProgress", {
                                                    done: fileBatchDeleteProgress.done,
                                                    total: fileBatchDeleteProgress.total,
                                                })
                                                : t("layout.fileBatchSelectedCount", { count: selectedFileIds.length })}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => void onDeleteBatchFiles()}
                                            disabled={fileBatchDeleting || selectedFileIds.length === 0}
                                            className="rounded-md bg-rose-500 px-2 py-1 text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {fileBatchDeleting ? t("layout.fileDeletingBusy") : t("layout.fileBatchDelete")}
                                        </button>
                                    </div>
                                )}
                                <div className="px-6 pt-4">
                                    {fileHistoryLoadingRoomId === selectedFileRoomId && (
                                        <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                                            {t("common.loading")}
                                        </div>
                                    )}
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px]">
                                        <input
                                            type="text"
                                            value={fileListSearch}
                                            onChange={(event) => setFileListSearch(event.target.value)}
                                            placeholder={t("layout.filesListSearchPlaceholder")}
                                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                        />
                                        <select
                                            value={fileListTypeFilter}
                                            onChange={(event) =>
                                                setFileListTypeFilter(
                                                    event.target.value as "all" | "image" | "video" | "audio" | "pdf" | "other",
                                                )
                                            }
                                            className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                                <div className="px-6 pt-3 pb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                                    <div className="grid grid-cols-[32px_84px_90px_90px_1fr] gap-2">
                                        <span />
                                        <span>{t("layout.fileColumnPreview")}</span>
                                        <span>{t("layout.fileColumnType")}</span>
                                        <span>{t("layout.fileColumnSize")}</span>
                                        <span>{t("layout.fileColumnActions")}</span>
                                    </div>
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar px-6 pb-6 space-y-2">
                                    {visibleSelectedRoomFiles.length === 0 ? (
                                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                                            {t("layout.fileListEmptyInRoom")}
                                        </div>
                                    ) : (
                                        pagedVisibleSelectedRoomFiles.map((item) => {
                                            const fileType = getFileTypeGroup(item);
                                            const ext = getFileExtension(item.body, item.mimeType);
                                            const httpUrl = getHttpFileUrl(item);
                                            return (
                                                <div key={item.eventId} className="grid grid-cols-[32px_84px_90px_90px_1fr] items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2 py-2 dark:border-slate-800 dark:bg-slate-950">
                                                    <div className="flex items-center justify-center">
                                                        {fileBatchMode ? (
                                                            <input
                                                                type="checkbox"
                                                                checked={isFileSelected(item.eventId)}
                                                                onChange={() => toggleFileSelection(item.eventId)}
                                                                className="h-4 w-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-900"
                                                            />
                                                        ) : null}
                                                    </div>
                                                    <div className="h-14 w-20 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                                                        {fileType === "image" && httpUrl ? (
                                                            <button type="button" onClick={() => onPreviewFileItem(item)} className="h-full w-full">
                                                                <img src={httpUrl} alt={item.body} className="h-full w-full object-cover" />
                                                            </button>
                                                        ) : fileType === "video" && httpUrl ? (
                                                            <button type="button" onClick={() => onPreviewFileItem(item)} className="h-full w-full">
                                                                <video src={httpUrl} className="h-full w-full object-cover" muted preload="metadata" />
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => onPreviewFileItem(item)}
                                                                disabled={fileType === "other"}
                                                                className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-500 disabled:cursor-default dark:text-slate-300"
                                                            >
                                                                {ext}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="text-sm text-slate-700 dark:text-slate-200">{ext}</div>
                                                    <div className="text-sm text-slate-700 dark:text-slate-200">
                                                        {item.sizeBytes == null ? "--" : `${formatBytesToMb(item.sizeBytes)} MB`}
                                                    </div>
                                                    <div className="relative flex items-center justify-between gap-2">
                                                        <div className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
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
                                                            <div className="absolute right-0 top-7 z-20 w-28 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
                                                                {getFilePreviewType(item) && (
                                                                    <button
                                                                        type="button"
                                                                        className="w-full px-3 py-1.5 text-left text-slate-600 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
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
                                                                    className="w-full px-3 py-1.5 text-left text-slate-600 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
                                                                    onClick={() => {
                                                                        setActiveFileMenuEventId(null);
                                                                        onOpenFileItem(item);
                                                                    }}
                                                                >
                                                                    {t("layout.fileActionDownload")}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="w-full px-3 py-1.5 text-left text-slate-600 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
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
                                                                    className="w-full px-3 py-1.5 text-left text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300 dark:hover:bg-slate-800"
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
                                            className="mx-auto block rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300"
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
                ) : activeTab === "notebook" ? (
                    notebookSidebarMode === "chatSummary" ? (
                        <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar bg-white p-6 dark:bg-slate-900">
                            <div className="mx-auto w-full max-w-5xl">
                                <div className="mb-4 text-base font-semibold text-slate-800 dark:text-slate-100">
                                    {t("layout.notebook.summaryWorkspaceTitle", "AI Chat Summary")}
                                </div>
                                <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-slate-700 dark:bg-slate-950">
                                    <button
                                        type="button"
                                        onClick={() => setSummaryDetailTab("chatContent")}
                                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                                            summaryDetailTab === "chatContent"
                                                ? "bg-[#2F5C56] text-white dark:bg-emerald-500"
                                                : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"
                                        }`}
                                    >
                                        {t("layout.notebook.summaryDetailTabChatContent", "聊天內容")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSummaryDetailTab("summaryList")}
                                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                                            summaryDetailTab === "summaryList"
                                                ? "bg-[#2F5C56] text-white dark:bg-emerald-500"
                                                : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"
                                        }`}
                                    >
                                        {t("layout.notebook.summaryDetailTabSummaryList", "總結清單")}
                                    </button>
                                </div>

                                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 dark:border-slate-700 dark:bg-slate-950">
                                    {!summarySelectedTarget ? (
                                        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                                            {t("layout.notebook.summaryWorkspaceEmpty", "請先在左側選擇人員或聊天室。")}
                                        </div>
                                    ) : summaryDetailTab === "chatContent" ? (
                                        <div className="space-y-3">
                                            {summaryGenerationNotice ? (
                                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200">
                                                    {summaryGenerationNotice}
                                                </div>
                                            ) : null}
                                            {summaryContentLoading ? (
                                                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                                                    {t("layout.notebook.summaryLoadingContent", "Loading chat content...")}
                                                </div>
                                            ) : summaryContentError ? (
                                                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                                                    {summaryContentError}
                                                </div>
                                            ) : summaryChatMessages.length === 0 ? (
                                                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                                                    {t("layout.notebook.summaryNoChatContent", "No chat content in the selected range.")}
                                                </div>
                                            ) : (
                                                <div className="max-h-[62vh] overflow-y-auto space-y-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                                                    {summaryChatMessages.map((message) => (
                                                        <div
                                                            key={message.eventId}
                                                            className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                                                        >
                                                            <div className="mb-1 flex items-center justify-between gap-2">
                                                                <div className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                                                                    {message.sender}
                                                                </div>
                                                                <div className="text-[11px] text-slate-400">
                                                                    {message.ts ? new Date(message.ts).toLocaleString() : ""}
                                                                </div>
                                                            </div>
                                                            <div className="text-sm text-slate-800 dark:text-slate-100">
                                                                {message.translatedText || message.text}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="flex justify-end">
                                                <button
                                                    type="button"
                                                    onClick={() => void onStartGenerateSummary()}
                                                    disabled={summaryJobActionBusy || summaryContentLoading || summaryChatMessages.length === 0 || hasProcessingSummaryJob}
                                                    className="inline-flex items-center justify-center rounded-xl bg-[#2F5C56] px-4 py-2 text-sm font-semibold text-white shadow-sm enabled:hover:bg-[#244a45] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500 dark:enabled:hover:bg-emerald-400"
                                                >
                                                    {hasProcessingSummaryJob
                                                        ? t("layout.notebook.summaryGenerating", "Generating...")
                                                        : t("layout.notebook.summaryStartGenerate", "Start generate summary")}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {summaryJobsError ? (
                                                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-500 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                                                    {summaryJobsError}
                                                </div>
                                            ) : null}
                                            {summaryJobsLoading ? (
                                                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                                                    {t("layout.notebook.summaryJobsLoading", "Loading summary list...")}
                                                </div>
                                            ) : summaryJobs.length === 0 ? (
                                                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                                                    {t("layout.notebook.summaryJobsEmpty", "No generated summary yet.")}
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {summaryJobs.map((job) => (
                                                        <div
                                                            key={job.id}
                                                            className="rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900"
                                                        >
                                                            <div className="mb-1 flex items-center justify-between gap-3">
                                                                <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                                    {`${job.target_label}${t("layout.notebook.summaryJobNameSuffix", "聊天室总结")}`}
                                                                </div>
                                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                                    job.status === "completed"
                                                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                                                                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                                                                }`}>
                                                                    {job.status === "completed"
                                                                        ? t("layout.notebook.summaryStatusCompleted", "Completed")
                                                                        : t("layout.notebook.summaryStatusProcessing", "Processing")}
                                                                </span>
                                                            </div>
                                                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                                                {`${job.from_date} ~ ${job.to_date}`}
                                                            </div>
                                                            <div className="mt-2 flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    disabled={summaryJobActionBusy || job.status !== "completed" || !job.has_content}
                                                                    onClick={() => void onDownloadSummaryJob(job)}
                                                                    className="rounded-md border border-emerald-500 px-2 py-1 text-xs font-semibold text-emerald-700 enabled:hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-400 dark:text-emerald-300 dark:enabled:hover:bg-emerald-900/20"
                                                                >
                                                                    {t("layout.notebook.summaryDownload", "Download")}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={summaryJobActionBusy}
                                                                    onClick={() => void onDeleteSummaryJob(job.id)}
                                                                    className="rounded-md border border-rose-400 px-2 py-1 text-xs font-semibold text-rose-600 enabled:hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-400 dark:text-rose-300 dark:enabled:hover:bg-rose-900/20"
                                                                >
                                                                    {t("layout.notebook.summaryDelete", "Delete")}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <NotebookPanel
                            enabled={notebookCapabilityState.canUseNotebookBasic}
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
                                void notebookModule.switchItemMode(true);
                            }}
                            onSwitchToNote={() => {
                                void notebookModule.switchItemMode(false);
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
                                const maxBytes = notebookUploadLimitMb * 1024 * 1024;
                                if (file.size > maxBytes) {
                                    window.alert(`檔案超過上限（${notebookUploadLimitMb}MB）`);
                                    return;
                                }
                                void (async () => {
                                    try {
                                        const uploadResult = (await matrixClient.uploadContent(file, {
                                            includeFilename: false,
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
                                    } catch {
                                        // attach/upload failures are reflected by notebook module action state or ignored safely
                                    }
                                })();
                            }}
                            uploadLimitMb={notebookUploadLimitMb}
                            onDeleteFile={(fileId) => {
                                void notebookModule.removeFile(fileId);
                            }}
                            onDownloadFile={(mxcUrl, preferredName) => {
                                if (!matrixClient) return;
                                const url = matrixClient.mxcUrlToHttp(mxcUrl);
                                if (!url) return;
                                const anchor = document.createElement("a");
                                anchor.href = url;
                                anchor.download = preferredName || "notebook-file";
                                anchor.rel = "noopener noreferrer";
                                document.body.appendChild(anchor);
                                anchor.click();
                                document.body.removeChild(anchor);
                            }}
                            draftFiles={notebookModule.draftFiles}
                            previewBusy={notebookModule.previewBusy}
                            previewError={notebookModule.previewError}
                            parsedPreview={notebookModule.parsedPreview}
                            chunks={notebookModule.chunks}
                            chunksTotal={notebookModule.chunksTotal}
                            busy={notebookModule.actionBusy}
                            actionError={notebookModule.actionError}
                            onMobileBack={() => setMobileView("list")}
                            chunkSettings={notebookModule.chunkSettings}
                            onChunkSettingsChange={notebookModule.setChunkSettings}
                        />
                    )
                ) : activeTab === "settings" || activeTab === "account" ? (
                    <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar flex flex-col bg-white dark:bg-slate-900">
                        {activeTab === "settings" && settingsDetail === "chat-language" ? (
                            <>
                                <div className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                                    {t("layout.selectItem")}
                                </div>
                                <div className="px-6">
                                    <div className="flex items-center gap-3 mb-4">
                                        <button
                                            type="button"
                                            onClick={() => setMobileView("list")}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                                            aria-label={t("layout.backToList")}
                                        >
                                            &lt;
                                        </button>
                                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                            {t("layout.chatReceiveLanguage")}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                        {translationLanguageOptions.map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setPendingChatReceiveLanguage(option.value)}
                                                className={`rounded-lg border px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800 ${pendingChatReceiveLanguage === option.value
                                                    ? "border-yellow-400 text-yellow-600 dark:text-yellow-300"
                                                    : "border-gray-200"
                                                    }`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="mt-auto px-6 pb-6">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            void handleChatReceiveLanguageChange(pendingChatReceiveLanguage).then(() => {
                                                setSettingsDetail("none");
                                                setMobileView("list");
                                            })
                                        }
                                        className="w-full rounded-xl bg-[#2F5C56] px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#244a45] dark:bg-emerald-500 dark:hover:bg-emerald-400"
                                    >
                                        {t("common.confirm")}
                                    </button>
                                </div>
                            </>
                        ) : activeTab === "settings" && settingsDetail === "translation-default" ? (
                            <>
                                <div className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                                    {t("layout.selectItem")}
                                </div>
                                <div className="px-6">
                                    <div className="flex items-center gap-3 mb-4">
                                        <button
                                            type="button"
                                            onClick={() => setMobileView("list")}
                                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                                            aria-label={t("layout.backToList")}
                                        >
                                            &lt;
                                        </button>
                                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                            {t("layout.translationDefaultContent")}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTranslationDefaultView("translated");
                                                setSettingsDetail("none");
                                                setMobileView("list");
                                            }}
                                            className={`rounded-lg border px-3 py-2 text-sm ${translationDefaultView === "translated"
                                                    ? "border-emerald-400 text-emerald-600"
                                                    : "border-gray-200 text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                                                }`}
                                        >
                                            {t("layout.translationDefaultTranslated")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTranslationDefaultView("original");
                                                setSettingsDetail("none");
                                                setMobileView("list");
                                            }}
                                            className={`rounded-lg border px-3 py-2 text-sm ${translationDefaultView === "original"
                                                    ? "border-emerald-400 text-emerald-600"
                                                    : "border-gray-200 text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                                                }`}
                                        >
                                            {t("layout.translationDefaultOriginal")}
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                {t("layout.selectItem")}
                            </div>
                        )}
                    </div>
                ) : (
                    <Outlet
                        context={{
                            activeRoomId,
                            onMobileBack: () => setMobileView("list"),
                            onHideRoom: () => void onHideActiveRoom(),
                            onLeaveRoom: () => void onLeaveActiveRoom(),
                            onTogglePin: () => onTogglePinActiveRoom(),
                            isRoomPinned: isActiveRoomPinned,
                            chatReceiveLanguage,
                            translationDefaultView,
                            companyName: meProfile?.company_name ?? null,
                            jumpToEventId,
                            onJumpHandled: () => setJumpToEventId(null),
                            notebookAssistEnabled: notebookCapabilityState.canUseNotebookAssist,
                            notebookCapabilities: capabilityValues,
                            notebookCapabilityError: capabilityError,
                            onRetryNotebookCapability: retryNotebookCapability,
                            onReloginForNotebook: onLogout,
                            hasNotebookAuthToken: Boolean(capabilityToken),
                            notebookApiBaseUrl: notebookApiBaseUrlOverride,
                        }}
                    />
                )}

                {/* Placeholder for when no chat is selected (if Outlet is empty) */}
                {/* <div className="flex-1 flex items-center justify-center text-gray-400">Select a chat to start messaging</div> */}
            </main>

            {/* Create Room Modal */}
            <CreateRoomModal
                isOpen={showCreateRoomModal}
                onClose={() => setShowCreateRoomModal(false)}
                onSuccess={(roomId) => {
                    setActiveRoomId(roomId);
                    setActiveTab("chat");
                    setMobileView("detail");
                }}
                matrixClient={matrixClient}
                accessToken={hubAccessToken}
                hsUrl={matrixHsUrl}
            />
            {removedFromRoomNotice && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
                            {t("chat.removedPopupTitle", "Notice")}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                            {t(
                                "chat.removedPopupMessage",
                                "You have been removed from room - {{roomName}}",
                                { roomName: removedFromRoomNotice.roomName },
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => setRemovedFromRoomNotice(null)}
                            className="w-full rounded-lg bg-[#2F5C56] px-3 py-2 text-sm font-semibold text-white hover:bg-[#244a45] dark:bg-emerald-500 dark:hover:bg-emerald-400"
                        >
                            {t("common.confirm")}
                        </button>
                    </div>
                </div>
            )}
            {filePreview && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4"
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
                        onClick={() => setFilePreview(null)}
                        className="absolute top-6 right-6 rounded-full bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20"
                    >
                        {t("common.close")}
                    </button>
                    {filePreview.type === "image" ? (
                        <div
                            className="max-h-[90vh] max-w-[90vw] cursor-grab"
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
                                className="max-h-[90vh] max-w-[90vw] select-none"
                                style={{
                                    transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewZoom})`,
                                    transition: previewDraggingRef.current ? "none" : "transform 120ms ease",
                                }}
                                draggable={false}
                            />
                        </div>
                    ) : filePreview.type === "pdf" ? (
                        <iframe src={filePreview.url} title={filePreview.name} className="h-[90vh] w-[90vw] rounded-lg bg-white" />
                    ) : filePreview.type === "audio" ? (
                        <div className="w-full max-w-xl rounded-xl bg-slate-900 p-6">
                            <div className="mb-3 text-sm text-slate-200">{filePreview.name}</div>
                            <audio src={filePreview.url} controls autoPlay className="w-full" />
                        </div>
                    ) : (
                        <video src={filePreview.url} controls autoPlay className="max-h-[90vh] max-w-[90vw] rounded-lg" />
                    )}
                </div>
            )}
        </div>
    );
};
