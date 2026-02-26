import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import {
    ChatBubbleLeftRightIcon,
    BookOpenIcon,
    UserGroupIcon,
    Cog6ToothIcon,
    FolderIcon,
} from "@heroicons/react/24/outline";
import { ClientEvent, EventTimeline, EventType, RoomEvent, type MatrixEvent, type Room } from "matrix-js-sdk";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../stores/ThemeStore";
import { useAuthStore } from "../stores/AuthStore";
import { RoomList } from "../features/rooms";
import type { ContactSummary } from "../features/rooms/RoomList";
import { hubGetMe, hubMeUpdateLocale, hubMeUpdateTranslationLocale } from "../api/hub";
import type { HubProfileSummary } from "../api/types";
import { removeContact } from "../api/contacts";
import { getDirectRoomId, getOrCreateDirectRoom, hideDirectRoom } from "../matrix/direct";
import { CreateGroupModal } from "../features/groups/CreateGroupModal";
import { GroupInviteList } from "../features/groups/GroupInviteList";
// GroupDetailsPanel 將在 ChatRoom 中整合使用
// import { GroupDetailsPanel, isGroupRoom } from "../features/groups/GroupDetailsPanel";
import { translationLanguageOptions } from "../constants/translationLanguages";
import { ensureNotificationSoundEnabled, isNotificationSoundSupported } from "../utils/notificationSound";
import { updateStaffLanguage, updateStaffTranslationLanguage } from "../api/profile";
import { getSupabaseClient } from "../api/supabase";
import { setLanguage } from "../i18n";
import { markRoomDeprecated } from "../services/matrix";
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
    getNotebookAdapter,
    NotebookPanel,
    NotebookSidebar,
    resolveNotebookCapabilities,
    useNotebookModule,
} from "../features/notebook";
import {
    getCompanyNotebookAiSettings,
    getCompanyTranslationSettings,
    getNotebookCapabilities,
    type CompanyNotebookAiSettingsResponse,
    type CompanyTranslationSettingsResponse,
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
    const [mobileView, setMobileView] = useState<"list" | "detail">("list");
    const [settingsDetail, setSettingsDetail] = useState<
        "none" | "chat-language" | "translation-default" | "notebook-policy" | "translation-policy"
    >("none");
    const [notebookPolicy, setNotebookPolicy] = useState<CompanyNotebookAiSettingsResponse | null>(null);
    const [translationPolicy, setTranslationPolicy] = useState<CompanyTranslationSettingsResponse | null>(null);
    const [policyLoading, setPolicyLoading] = useState(false);
    const [policyError, setPolicyError] = useState<string | null>(null);
    const [displayLanguage, setDisplayLanguage] = useState<string>("en");
    const [chatReceiveLanguage, setChatReceiveLanguage] = useState<string>("en");
    const [pendingChatReceiveLanguage, setPendingChatReceiveLanguage] = useState<string>("en");
    const [translationDefaultView, setTranslationDefaultView] = useState<"translated" | "original">("translated");
    const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
    const [removedFromRoomNotice, setRemovedFromRoomNotice] = useState<{ roomName: string } | null>(null);
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
    const [meProfile, setMeProfile] = useState<HubProfileSummary | null>(null);
    const [notebookApiBaseUrlOverride, setNotebookApiBaseUrlOverride] = useState<string | null>(null);
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
    const meUpdateToken = hubAccessToken && !localeTokenExpired ? hubAccessToken : null;
    const meUpdateOptions = undefined;
    const [capabilityValues, setCapabilityValues] = useState<string[]>([]);
    const [capabilityLoaded, setCapabilityLoaded] = useState(false);
    const [capabilityError, setCapabilityError] = useState<string | null>(null);
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
    const retryNotebookCapability = useCallback(() => {
        setCapabilityRefreshSeq((prev) => prev + 1);
    }, []);
    useEffect(() => {
        if (notebookToken.reason !== "expired_hub_token") return;
        if (!hubSession?.refresh_token) return;
        let alive = true;
        void (async (): Promise<void> => {
            try {
                const supabase = getSupabaseClient();
                const { data, error } = await supabase.auth.refreshSession({
                    refresh_token: hubSession.refresh_token,
                });
                if (error || !data.session?.access_token) {
                    throw new Error("INVALID_AUTH_TOKEN");
                }
                if (!alive) return;
                setHubSession({
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token || hubSession.refresh_token,
                    expires_at: data.session.expires_at ?? undefined,
                });
                setCapabilityTokenRefreshSeq((prev) => prev + 1);
            } catch {
                if (!alive) return;
                setCapabilityError(t("layout.notebook.authFailed"));
            }
        })();
        return () => {
            alive = false;
        };
    }, [hubSession, notebookToken.reason, setHubSession, t]);
    const notebookModule = useNotebookModule({
        adapter: notebookAdapter,
        auth: notebookAuth,
        enabled: notebookCapabilityState.canUseNotebookBasic && activeTab === "notebook",
    });
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
        matrixClient.startClient({ initialSyncLimit: 20 });
        return () => {
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
        if (!capabilityToken) {
            setCapabilityLoaded(true);
            setCapabilityValues([]);
            if (
                notebookToken.reason === "expired_hub_token" ||
                notebookToken.reason === "missing_hub_token" ||
                notebookToken.reason === "invalid_hub_token_format"
            ) {
                setCapabilityError(t("layout.notebook.authFailed"));
            } else {
                setCapabilityError(t("layout.notebook.authFailed"));
            }
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
    }, [capabilityToken, notebookApiBaseUrlOverride, hubMeResolved, matrixCredentials?.user_id, matrixHsUrl, capabilityRefreshSeq, capabilityTokenRefreshSeq, notebookToken.reason, userType, t]);

    useEffect(() => {
        if (activeTab !== "settings") return;
        if (!notebookAuth || !notebookApiBaseUrlOverride) {
            setNotebookPolicy(null);
            setTranslationPolicy(null);
            return;
        }
        let alive = true;
        setPolicyLoading(true);
        setPolicyError(null);
        void Promise.all([
            getCompanyNotebookAiSettings(notebookAuth),
            getCompanyTranslationSettings(notebookAuth),
        ]).then(([nb, tr]) => {
            if (!alive) return;
            setNotebookPolicy(nb);
            setTranslationPolicy(tr);
            setPolicyError(null);
        }).catch((error) => {
            if (!alive) return;
            if (error instanceof NotebookServiceError) {
                if (error.code === "NO_VALID_HUB_TOKEN" || error.code === "INVALID_AUTH_TOKEN" || error.code === "INVALID_TOKEN_TYPE") {
                    setPolicyError(t("layout.notebook.authFailed"));
                } else if (error.code === "CAPABILITY_DISABLED") {
                    setPolicyError(t("layout.notebook.capabilityDisabled"));
                } else if (error.code === "CAPABILITY_EXPIRED") {
                    setPolicyError(t("layout.notebook.capabilityExpired"));
                } else if (error.code === "QUOTA_EXCEEDED") {
                    setPolicyError(t("layout.notebook.quotaExceeded"));
                } else {
                    setPolicyError(t("layout.notebook.systemBusy"));
                }
            } else {
                setPolicyError(t("layout.notebook.systemBusy"));
            }
        }).finally(() => {
            if (!alive) return;
            setPolicyLoading(false);
        });
        return () => {
            alive = false;
        };
    }, [activeTab, notebookAuth, notebookApiBaseUrlOverride, t]);

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
        setMobileView("list");
        setSettingsDetail("none");
    }, [activeTab]);

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

    const onStartContactChat = async (): Promise<void> => {
        if (!matrixClient || !activeContact) return;
        const matrixUserId =
            activeContact.matrixUserId ||
            (activeContact.userLocalId && matrixHost ? `@${activeContact.userLocalId}:${matrixHost}` : null);
        if (!matrixUserId) return;
        const roomId = await getOrCreateDirectRoom(matrixClient, matrixUserId);
        setActiveRoomId(roomId);
        setActiveTab("chat");
        setMobileView("detail");
    };

    const onRemoveActiveContact = async (): Promise<void> => {
        if (!actionToken || !activeContact) return;
        try {
            await removeContact(actionToken, activeContact.id, actionHsUrl);
            const matrixUserId =
                activeContact.matrixUserId ||
                (activeContact.userLocalId && matrixHost ? `@${activeContact.userLocalId}:${matrixHost}` : null);
            if (matrixClient && matrixUserId) {
                const roomId =
                    getDirectRoomId(matrixClient, matrixUserId) ??
                    ((matrixClient.getAccountData(EventType.Direct)?.getContent() as Record<string, string[]>)?.[
                        matrixUserId
                    ] ?? []).find((id) => Boolean(matrixClient.getRoom(id))) ??
                    matrixClient
                        .getRooms()
                        .find(
                            (room) =>
                                room.getMyMembership() === "join" &&
                                room.getJoinedMembers().length === 2 &&
                                room.getJoinedMembers().some((member) => member.userId === matrixUserId),
                        )?.roomId ??
                    null;
                if (roomId) {
                    try {
                        await markRoomDeprecated(roomId);
                    } catch {
                        // ignore mark failures
                    }
                    await hideDirectRoom(matrixClient, matrixUserId, roomId);
                    await matrixClient.leave(roomId);
                }
            }
            setActiveContact(null);
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
                        className="w-10 h-10 bg-[#2F5C56] rounded-xl flex items-center justify-center text-white font-bold text-sm"
                        aria-label={t("layout.accountMenu")}
                    >
                        {accountInitial}
                    </button>
                    {showAccountMenu && (
                        <div
                            ref={accountMenuRef}
                            className="absolute left-0 z-30 mt-2 w-36 rounded-lg border border-gray-200 bg-white py-2 text-sm shadow-2xl ring-1 ring-black/5 dark:border-slate-800 dark:bg-slate-900"
                        >
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
                            <button
                                type="button"
                                onClick={onLogout}
                                className="w-full px-3 py-2 text-left text-rose-500 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-slate-800"
                            >
                                {t("layout.logout")}
                            </button>
                        </div>
                    )}
                </div>

                {/* Nav Items */}
                <div className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-700/70 bg-slate-800/60 px-1 py-1 sm:gap-2 lg:w-full lg:flex-col lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
                    <NavBarItem
                        icon={ChatBubbleLeftRightIcon}
                        active={activeTab === "chat"}
                        badgeCount={unreadBadgeCount}
                        onClick={() => setActiveTab("chat")}
                    />
                    {notebookCapabilityState.canUseNotebookBasic && (
                        <NavBarItem
                            icon={BookOpenIcon}
                            active={activeTab === "notebook"}
                            onClick={() => setActiveTab("notebook")}
                        />
                    )}
                    <NavBarItem
                        icon={UserGroupIcon}
                        active={activeTab === "contacts"}
                        badgeCount={inviteBadgeCount}
                        onClick={() => setActiveTab("contacts")}
                    />
                    <NavBarItem
                        icon={FolderIcon}
                        active={activeTab === "files"}
                        onClick={() => setActiveTab("files")}
                    />
                    <NavBarItem
                        icon={Cog6ToothIcon}
                        active={activeTab === "settings"}
                        onClick={() => {
                            setActiveTab("settings");
                            setSettingsDetail("none");
                            setMobileView("list");
                        }}
                        className="lg:hidden"
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
                className={`w-full bg-white border-r border-gray-200 flex flex-col flex-shrink-0 z-10 shadow-sm dark:bg-slate-900 dark:border-slate-800 lg:w-80 ${mobileView === "detail" ? "hidden lg:flex" : "flex"
                    }`}
            >
                {activeTab === "settings" ? (
                    <>
                        <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {t("layout.settings")}
                            </div>
                        </div>
                        <div className="p-4 space-y-3">
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
                            <button
                                type="button"
                                onClick={() => {
                                    setSettingsDetail("notebook-policy");
                                    setMobileView("detail");
                                }}
                                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("layout.notebook.platformNotebookPolicy")}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setSettingsDetail("translation-policy");
                                    setMobileView("detail");
                                }}
                                className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("layout.notebook.platformTranslationPolicy")}
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
                            <label className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800">
                                {t("layout.uploadAvatar")}
                                <input type="file" accept="image/*" className="hidden" />
                            </label>
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
                        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
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
                                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                        {accountId}
                                    </div>
                                    <div className="text-xs text-slate-500 truncate dark:text-slate-400">{accountSubtitle}</div>
                                </div>
                            </div>
                        </div>

                        {/* Search Bar */}
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
                                    placeholder={t("layout.searchPlaceholder")}
                                    className="bg-transparent border-none outline-none text-sm w-full text-slate-700 placeholder-gray-400 dark:text-slate-200 dark:placeholder-slate-500"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowCreateGroupModal(true)}
                                    className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-300"
                                >
                                    {t("layout.groupChat")}
                                </button>
                            </div>
                        </div>

                        {/* Group Invite List - 獨立組件，不影響私聊邏輯 */}
                        {activeTab === "chat" && (
                            <GroupInviteList
                                client={matrixClient}
                                onAccept={(roomId) => {
                                    setActiveRoomId(roomId);
                                    setMobileView("detail");
                                }}
                                onDecline={() => {
                                    // 拒絕後不需要特殊處理
                                }}
                            />
                        )}

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
                            enableContactPolling={activeTab === "contacts"}
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
                    <div className="flex-1 flex flex-col bg-white dark:bg-slate-900">
                        {activeContact ? (
                            <div className="flex-1 flex flex-col">
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
                                        <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-semibold dark:bg-emerald-900/40 dark:text-emerald-200">
                                            {getContactLabel(activeContact).charAt(0).toUpperCase()}
                                        </div>
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

                                <div className="flex-1 px-6 py-6 sm:px-8">
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                {t("layout.details.id")}
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {activeContact.userLocalId || getLocalPart(activeContact.matrixUserId) || t("common.placeholder")}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                {t("layout.details.name")}
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {activeContact.displayName || t("common.placeholder")}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                {t("layout.details.gender")}
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {getGenderLabel(activeContact.gender)}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                {t("layout.details.country")}
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {activeContact.country || t("common.placeholder")}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                {t("layout.details.language")}
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {getLanguageLabel(activeContact)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="px-6 pb-8 sm:px-8">
                                    <button
                                        type="button"
                                        onClick={() => void onStartContactChat()}
                                        className="inline-flex items-center justify-center rounded-xl bg-[#2F5C56] px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#244a45] dark:bg-emerald-500 dark:hover:bg-emerald-400"
                                    >
                                        {t("layout.chatAction")}
                                    </button>
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
                                <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2">
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
                        previewBusy={notebookModule.previewBusy}
                        previewError={notebookModule.previewError}
                        parsedPreview={notebookModule.parsedPreview}
                        chunks={notebookModule.chunks}
                        chunksTotal={notebookModule.chunksTotal}
                        busy={notebookModule.actionBusy}
                        actionError={notebookModule.actionError}
                        onMobileBack={() => setMobileView("list")}
                    />
                ) : activeTab === "settings" || activeTab === "account" ? (
                    <div className="flex-1 flex flex-col bg-white dark:bg-slate-900">
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
                                                    ? "border-emerald-400 text-emerald-600"
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
                                            className={`rounded-lg border px-3 py-2 text-sm ${
                                                translationDefaultView === "translated"
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
                                            className={`rounded-lg border px-3 py-2 text-sm ${
                                                translationDefaultView === "original"
                                                    ? "border-emerald-400 text-emerald-600"
                                                    : "border-gray-200 text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                                            }`}
                                        >
                                            {t("layout.translationDefaultOriginal")}
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : activeTab === "settings" && (settingsDetail === "notebook-policy" || settingsDetail === "translation-policy") ? (
                            <>
                                <div className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                                    {t("layout.selectItem")}
                                </div>
                                <div className="px-6 pb-6">
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
                                            {settingsDetail === "notebook-policy"
                                                ? t("layout.notebook.platformNotebookPolicy")
                                                : t("layout.notebook.platformTranslationPolicy")}
                                        </div>
                                    </div>
                                    {policyLoading ? (
                                        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                                            {t("common.loading")}
                                        </div>
                                    ) : policyError ? (
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/30 dark:text-rose-200">
                                            {policyError}
                                        </div>
                                    ) : (
                                        (() => {
                                            const target = settingsDetail === "notebook-policy" ? notebookPolicy : translationPolicy;
                                            const enabled = settingsDetail === "notebook-policy"
                                                ? Boolean(notebookPolicy?.notebook_ai_enabled)
                                                : Boolean(translationPolicy?.translation_enabled);
                                            const expireAt = settingsDetail === "notebook-policy"
                                                ? notebookPolicy?.notebook_ai_expire_at
                                                : translationPolicy?.translation_expire_at;
                                            const monthlyQuota = settingsDetail === "notebook-policy"
                                                ? notebookPolicy?.notebook_ai_quota_monthly_requests
                                                : translationPolicy?.translation_quota_monthly_requests;
                                            const monthlyUsed = settingsDetail === "notebook-policy"
                                                ? notebookPolicy?.notebook_ai_quota_used_monthly_requests
                                                : translationPolicy?.translation_quota_used_monthly_requests;

                                            return (
                                                <div className="space-y-3">
                                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                                                        <div className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                                                            {t("layout.notebook.managedByPlatform")}
                                                        </div>
                                                        <div className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                                            {target?.managed_by_platform ? t("common.confirm") : t("common.cancel")}
                                                        </div>
                                                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                                            {t("layout.notebook.managedByPlatformHint")}
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                                                            <div className="text-xs uppercase tracking-[0.1em] text-slate-400">{t("layout.notebook.statusLabel")}</div>
                                                            <div className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                                                {enabled ? t("layout.notebook.enabled") : t("layout.notebook.disabled")}
                                                            </div>
                                                        </div>
                                                        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                                                            <div className="text-xs uppercase tracking-[0.1em] text-slate-400">{t("layout.notebook.expireAtLabel")}</div>
                                                            <div className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                                                {expireAt ? new Date(expireAt).toLocaleString() : t("common.placeholder")}
                                                            </div>
                                                        </div>
                                                        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                                                            <div className="text-xs uppercase tracking-[0.1em] text-slate-400">{t("layout.notebook.quotaMonthlyLabel")}</div>
                                                            <div className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                                                {typeof monthlyQuota === "number" ? monthlyQuota.toLocaleString() : t("common.placeholder")}
                                                            </div>
                                                        </div>
                                                        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                                                            <div className="text-xs uppercase tracking-[0.1em] text-slate-400">{t("layout.notebook.quotaUsedLabel")}</div>
                                                            <div className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                                                {typeof monthlyUsed === "number" ? monthlyUsed.toLocaleString() : t("common.placeholder")}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()
                                    )}
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

            {/* Create Group Modal */}
            <CreateGroupModal
                isOpen={showCreateGroupModal}
                onClose={() => setShowCreateGroupModal(false)}
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
