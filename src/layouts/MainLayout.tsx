import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import {
    ChatBubbleLeftRightIcon,
    BookOpenIcon,
    UserGroupIcon,
    Cog6ToothIcon,
    FolderIcon,
    ClockIcon,
    PuzzlePieceIcon,
    SparklesIcon,
    CommandLineIcon,
} from "@heroicons/react/24/outline";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/AuthStore";
import type { ContactSummary } from "../features/rooms/RoomList";
// Dynamically imported to keep hub API calls out of workspace-layout chunk:
// createChatSummaryJob, deleteChatSummaryJob, downloadChatSummaryJob,
// getChatSummaryJob, hubGetMe, hubMeUpdateLocale, hubMeUpdateTranslationLocale,
// listChatSummaryJobs, retryChatSummaryJob -> ../api/hub
// ChatSummaryJobDetail, ChatSummaryJobItem moved to NotebookPanel
import { HUB_SESSION_REVOKED_EVENT, HubApiError, type HubSessionRevokedDetail } from "../api/session";
import type { HubProfileSummary, HubSupabaseSession } from "../api/types";
// Dynamically imported to avoid pulling matrix-js-sdk into workspace-layout chunk:
// removeContact -> ../api/contacts
// getOrCreateDirectRoom, hideDirectRoom -> ../matrix/direct
// prepareMatrixClient -> ../matrix/client
// RoomDetailsPanel 將在 ChatRoom 中整合使用
// import { RoomDetailsPanel, isRoomWithMultipleMembers } from "../features/groups/RoomDetailsPanel";
import { translationLanguageOptions } from "../constants/translationLanguages";
import { displayLanguageOptions, isSupportedDisplayLanguage } from "../constants/displayLanguages";
import {
    ensureNotificationSoundEnabled,
    isNotificationSoundSupported,
    type NotificationSoundMode,
} from "../utils/notificationSound";
// Dynamically imported: updateStaffLanguage, updateStaffTranslationLanguage -> ../api/profile
// Dynamically imported: getSupabaseClient -> ../api/supabase
import { setLanguage } from "../i18n/language";
import { DEPRECATED_DM_PREFIX } from "../constants/rooms";
import { traceEvent } from "../utils/debugTrace";

import {
    ChatSearchError,
} from "../features/chat/chatSearchApi";
import {
    NotebookServiceError,
} from "../services/notebookApi";
import { resolveNotebookCapabilities } from "../features/notebook/capabilities";
import { buildNotebookAuth } from "../features/notebook/utils/buildNotebookAuth";
import { isNotebookTerminalAuthFailure, type NotebookTerminalAuthFailureSignal } from "../features/notebook/utils/isNotebookTerminalAuthFailure";
// Dynamically imported to keep notebook API calls out of workspace-layout chunk:
// getCompanyNotebookAiSettings, getNotebookCapabilities -> ../services/notebookApi
import { usePluginHost, usePluginSlot, type PluginIconKey } from "../plugins";
import { checkDesktopUpdaterOnce, getDesktopUpdaterStatus, isTauriDesktop } from "../desktop/useDesktopUpdater";
import { readWorkspaceStateFromSqlite, writeWorkspaceStateToSqlite } from "../desktop/desktopCacheDb";

import { useToastStore } from "../stores/ToastStore";
import { isTauriMobile, resolveRuntimePlatform } from "../runtime/appRuntime";
import { notebookApiBaseUrl as configuredNotebookApiBaseUrl } from "../config";
import {
    MATRIX_CLIENT_EVENT_EVENT,
    MATRIX_CLIENT_EVENT_ROOM,
    MATRIX_CLIENT_EVENT_SYNC,
    MATRIX_EVENT_TYPE_DIRECT,
    MATRIX_EVENT_TYPE_ROOM_MEMBER,
    MATRIX_EVENT_TYPE_ROOM_NAME,
    MATRIX_ROOM_EVENT_MY_MEMBERSHIP,
    MATRIX_ROOM_EVENT_TIMELINE,
    MATRIX_ROOM_EVENT_TIMELINE_RESET,
} from "../matrix/matrixEventConstants";

const RoomList = lazy(async () => {
    const module = await import("../features/rooms");
    return { default: module.RoomList };
});

const CreateRoomModal = lazy(async () => {
    const module = await import("../features/groups/CreateRoomModal");
    return { default: module.CreateRoomModal };
});

const NotebookPanel = lazy(() => import("./NotebookPanel").then((m) => ({ default: m.NotebookPanel })));
const ChatSearchBar = lazy(() => import("./ChatSearchBar").then((m) => ({ default: m.ChatSearchBar })));

const TaskWorkspaceDesktop = lazy(async () => {
    const module = await import("../features/tasks/components/TaskWorkspaceDesktop");
    return { default: module.TaskWorkspaceDesktop };
});

const FileCenterPanel = lazy(() => import("./FileCenterPanel"));
const ContactsPanel = lazy(() => import("./ContactsPanel"));
const SettingsAccountSidebar = lazy(() => import("./SettingsAccountPanel").then(m => ({ default: m.SettingsAccountSidebar })));
const SettingsAccountDetail = lazy(() => import("./SettingsAccountPanel").then(m => ({ default: m.SettingsAccountDetail })));

const bindMatrixRuntimeEvent = (client: any, event: string, listener: (...args: any[]) => void): void => {
    client.on(event, listener);
};

const unbindMatrixRuntimeEvent = (client: any, event: string, listener: (...args: any[]) => void): void => {
    client.off(event, listener);
};

// Placeholder for RoomList and ChatArea to be implemented later
// For now, we just create the layout structure
type NavBarItemProps = {
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    active?: boolean;
    onClick?: () => void;
    badgeCount?: number;
    className?: string;
    label?: string;
};

type MobileNavChipProps = {
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    active?: boolean;
    onClick?: () => void;
    badgeCount?: number;
    label: string;
};

type AppShellNavItem = {
    key: string;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    active: boolean;
    label: string;
    badgeCount?: number;
    onClick: () => void;
};

const NavBarItem = ({ icon: Icon, active, onClick, badgeCount, className = "", label }: NavBarItemProps) => (
    <div
        onClick={onClick}
        title={label}
        aria-label={label}
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

const MobileNavChip = ({ icon: Icon, active, onClick, badgeCount, label }: MobileNavChipProps) => (
    <button
        type="button"
        onClick={onClick}
        className={`relative inline-flex min-w-max items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${
            active
                ? "border-emerald-500 bg-emerald-50 text-emerald-900 shadow-sm dark:border-emerald-400/70 dark:bg-emerald-500/15 dark:text-emerald-100"
                : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-emerald-500/50 dark:hover:text-slate-100"
        }`}
        aria-pressed={active}
    >
        <span className="relative inline-flex h-5 w-5 items-center justify-center">
            <Icon className="h-5 w-5" />
            {typeof badgeCount === "number" && badgeCount > 0 ? (
                <span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[9px] font-semibold leading-4 text-white">
                    {badgeCount > 99 ? "99+" : badgeCount}
                </span>
            ) : null}
        </span>
        <span>{label}</span>
    </button>
);

function resolvePluginNavIcon(icon?: PluginIconKey): React.ComponentType<React.SVGProps<SVGSVGElement>> {
    switch (icon) {
        case "sparkles":
            return SparklesIcon;
        case "commandLine":
            return CommandLineIcon;
        case "book":
            return BookOpenIcon;
        case "folder":
            return FolderIcon;
        case "cog":
            return Cog6ToothIcon;
        case "puzzle":
        default:
            return PuzzlePieceIcon;
    }
}



function formatMatrixUserLocalId(matrixUserId: string | null | undefined): string {
    const raw = String(matrixUserId || "").trim();
    if (!raw) return "";
    const withoutPrefix = raw.startsWith("@") ? raw.slice(1) : raw;
    const colonIndex = withoutPrefix.indexOf(":");
    if (colonIndex <= 0) return withoutPrefix;
    return withoutPrefix.slice(0, colonIndex);
}

async function changeMatrixPassword(
    hsUrl: string,
    accessToken: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
): Promise<void> {
    const url = new URL("/_matrix/client/v3/account/password", hsUrl);
    const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            auth: {
                type: "m.login.password",
                identifier: {
                    type: "m.id.user",
                    user: userId,
                },
                password: currentPassword,
            },
            new_password: newPassword,
            logout_devices: false,
        }),
    });
    if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const data = (await response.json()) as { error?: string };
            if (data?.error) throw new Error(data.error);
        }
        const text = await response.text();
        throw new Error(text || `Request failed (${response.status})`);
    }
}

function resolveRoomListDisplayName(room: Room, myUserId: string | null): string {
    const fallback = room.name || room.getCanonicalAlias() || room.roomId;
    const explicitNameEvent = room.currentState.getStateEvents(MATRIX_EVENT_TYPE_ROOM_NAME, "");
    const explicitName = String((explicitNameEvent?.getContent() as { name?: string } | undefined)?.name || "").trim();
    if (explicitName) return explicitName;
    const normalizedMyUserId = myUserId || null;
    const joinedMembers = room.getJoinedMembers();
    if (normalizedMyUserId && joinedMembers.length === 2) {
        const other = joinedMembers.find((member) => member.userId !== normalizedMyUserId);
        if (other) {
            return other.name || formatMatrixUserLocalId(other.userId) || other.userId || fallback;
        }
    }

    if (normalizedMyUserId) {
        const selfMemberEvent = room.currentState.getStateEvents(MATRIX_EVENT_TYPE_ROOM_MEMBER, normalizedMyUserId);
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

// Summary helper functions moved to NotebookPanel.tsx

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

function toStoredHubSession(
    session: {
        access_token?: string | null;
        refresh_token?: string | null;
        expires_at?: number | null;
    } | null | undefined,
    fallbackRefreshToken?: string | null,
): HubSupabaseSession | null {
    const accessToken = session?.access_token?.trim();
    if (!accessToken) return null;
    return {
        access_token: accessToken,
        refresh_token: session?.refresh_token?.trim() || fallbackRefreshToken?.trim() || "",
        expires_at: typeof session?.expires_at === "number" ? session.expires_at : undefined,
    };
}

function isHubAuthFailure(error: unknown): boolean {
    if (error instanceof HubApiError) {
        return error.status === 401 || error.code === "INVALID_AUTH_TOKEN" || error.code === "NO_VALID_HUB_TOKEN";
    }
    if (error instanceof ChatSearchError) {
        return error.status === 401 && error.code !== "MISSING_MATRIX_TOKEN";
    }
    return false;
}

function isNotebookAuthFailure(error: unknown): boolean {
    return error instanceof NotebookServiceError
        && (
            error.status === 401
            || error.code === "INVALID_AUTH_TOKEN"
            || error.code === "INVALID_TOKEN_TYPE"
            || error.code === "NO_VALID_HUB_TOKEN"
        );
}




// CHAT_GLOBAL_SEARCH_DEBOUNCE_MS moved to ChatSearchBar.tsx / NotebookPanel.tsx
const TASKS_WARMUP_DELAY_MS = 600;
const FILES_WARMUP_DELAY_MS = 1400;
const NOTEBOOK_WARMUP_DELAY_MS = 2600;
const WORKSPACE_CACHE_PREFIX = "gtt_workspace_state_v1:";
const WORKSPACE_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const NOTEBOOK_API_BASE_URL_CACHE_PREFIX = "gtt_notebook_api_base_url_v1:";
const NOTEBOOK_CAPABILITIES_CACHE_PREFIX = "gtt_notebook_capabilities_v1:";
const NOTEBOOK_BOOT_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MATRIX_INITIAL_SYNC_LIMIT = (isTauriDesktop() && resolveRuntimePlatform() === "windows") ? 6 : 12;

type DeferredModuleState = {
    tasks: boolean;
    files: boolean;
    notebook: boolean;
};

type PersistedWorkspaceState = {
    activeTab?: "chat" | "notebook" | "contacts" | "files" | "tasks" | "orders" | "settings" | "account";
    activeRoomId?: string | null;
    selectedFileRoomId?: string | null;
    activeContactId?: string | null;
};

type PersistedNotebookBootValue<T> = {
    updatedAt: number;
    value: T;
};

function readWorkspaceState(cacheKey: string | null): PersistedWorkspaceState | null {
    if (!cacheKey || typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedWorkspaceState;
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function readNotebookBootCache<T>(cacheKey: string | null): T | null {
    if (!cacheKey || typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedNotebookBootValue<T>;
        if (!parsed || typeof parsed !== "object") return null;
        if (!Number.isFinite(parsed.updatedAt) || Date.now() - parsed.updatedAt > NOTEBOOK_BOOT_CACHE_TTL_MS) {
            window.localStorage.removeItem(cacheKey);
            return null;
        }
        return parsed.value ?? null;
    } catch {
        return null;
    }
}

function writeNotebookBootCache<T>(cacheKey: string | null, value: T | null): void {
    if (!cacheKey || typeof window === "undefined") return;
    try {
        if (value == null) {
            window.localStorage.removeItem(cacheKey);
            return;
        }
        window.localStorage.setItem(cacheKey, JSON.stringify({
            updatedAt: Date.now(),
            value,
        } satisfies PersistedNotebookBootValue<T>));
    } catch {
        // ignore notebook boot cache write failures
    }
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

export const MainLayout: React.FC = () => {
    const { t } = useTranslation();
    const { platformState, tools } = usePluginHost();
    const isMobileApp = isTauriMobile();
    const runtimePlatform = useMemo(() => resolveRuntimePlatform(), []);
    const isWindowsDesktop = useMemo(() => isTauriDesktop() && runtimePlatform === "windows", [runtimePlatform]);
    const shouldWarmDeferredModules = !(isTauriDesktop() && runtimePlatform === "windows");
    const [shellReady, setShellReady] = useState(!isWindowsDesktop);
    const [roomListMounted, setRoomListMounted] = useState(!isWindowsDesktop);
    const pluginNavItems = usePluginSlot("appNav");
    const pluginSettingsSections = usePluginSlot("settingsSections");
    const [activeTab, setActiveTab] = useState<"chat" | "notebook" | "contacts" | "files" | "tasks" | "orders" | "settings" | "account">("chat");
    const [deferredModules, setDeferredModules] = useState<DeferredModuleState>({
        tasks: false,
        files: false,
        notebook: false,
    });
    const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
    const [pinnedRoomIds, setPinnedRoomIds] = useState<string[]>([]);
    const [inviteBadgeCount, setInviteBadgeCount] = useState(0);
    const [unreadBadgeCount, setUnreadBadgeCount] = useState(0);
    const [activeContact, setActiveContact] = useState<ContactSummary | null>(null);
    const [restoredActiveContactId, setRestoredActiveContactId] = useState<string | null>(null);
    const [showContactMenu, setShowContactMenu] = useState(false);
    const [showRemoveContactConfirm, setShowRemoveContactConfirm] = useState(false);
    const [contactsRefreshToken, setContactsRefreshToken] = useState(0);
    const [notebookRefreshToken, setNotebookRefreshToken] = useState(0);
    const [fileLibraryTick, setFileLibraryTick] = useState(0);
    const [selectedFileRoomId, setSelectedFileRoomId] = useState<string | null>(null);
    const [jumpToEventId, setJumpToEventId] = useState<string | null>(null);
    const [selectedSharedRoomId, setSelectedSharedRoomId] = useState<string | null>(null);
    const [creatingContactRoom, setCreatingContactRoom] = useState(false);
    const [contactRoomActionError, setContactRoomActionError] = useState<string | null>(null);
    const [mobileView, setMobileView] = useState<"list" | "detail">("list");
    const [settingsDetail, setSettingsDetail] = useState<
        "none" | "chat-language" | "translation-default" | `plugin:${string}:${string}`
    >("none");
    // Shared preview overlay state (used by notebook onOpenPreview)
    const [filePreview, setFilePreview] = useState<{
        url: string;
        type: "image" | "video" | "audio" | "pdf";
        name: string;
        revokeOnClose?: boolean;
    } | null>(null);
    const [previewZoom, setPreviewZoom] = useState(1);
    const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
    const previewDraggingRef = useRef(false);
    const previewDragStartRef = useRef({ x: 0, y: 0 });
    const previewDragOriginRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        return () => {
            if (filePreview?.revokeOnClose) {
                URL.revokeObjectURL(filePreview.url);
            }
        };
    }, [filePreview]);

    const closeFilePreview = useCallback(() => {
        setFilePreview((prev) => {
            if (prev?.revokeOnClose) URL.revokeObjectURL(prev.url);
            return null;
        });
        setPreviewZoom(1);
        setPreviewOffset({ x: 0, y: 0 });
    }, []);

    const [displayLanguage, setDisplayLanguage] = useState<string>("en");
    const activePluginSettingsSection = useMemo(() => {
        if (!settingsDetail.startsWith("plugin:")) return null;
        return pluginSettingsSections.find((section) => `plugin:${section.pluginId}:${section.id}` === settingsDetail) ?? null;
    }, [pluginSettingsSections, settingsDetail]);
    const [chatReceiveLanguage, setChatReceiveLanguage] = useState<string>("en");
    const [chatReceiveLanguageSaving, setChatReceiveLanguageSaving] = useState(false);
    const [translationDefaultView, setTranslationDefaultView] = useState<"translated" | "original" | "bilingual">("translated");
    const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
    const [removedFromRoomNotice, setRemovedFromRoomNotice] = useState<{ roomName: string } | null>(null);
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
    const ensureMatrixClient = useAuthStore((state) => state.ensureMatrixClient);
    const navigate = useNavigate();
    const [showAccountMenu, setShowAccountMenu] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);
    const accountButtonRef = useRef<HTMLButtonElement | null>(null);
    const [meProfile, setMeProfile] = useState<HubProfileSummary | null>(null);
    const [accountAvatarUrl, setAccountAvatarUrl] = useState<string | null>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [avatarUploadFeedback, setAvatarUploadFeedback] = useState<string | null>(null);
    const [accountEditorMode, setAccountEditorMode] = useState<"none" | "name" | "password">("none");
    const [displayNameDraft, setDisplayNameDraft] = useState("");
    const [currentPasswordDraft, setCurrentPasswordDraft] = useState("");
    const [newPasswordDraft, setNewPasswordDraft] = useState("");
    const [confirmPasswordDraft, setConfirmPasswordDraft] = useState("");
    const [accountEditorBusy, setAccountEditorBusy] = useState(false);
    const [accountEditorError, setAccountEditorError] = useState<string | null>(null);
    const [accountEditorSuccess, setAccountEditorSuccess] = useState<string | null>(null);
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
    const mainPanelRef = useRef<HTMLElement | null>(null);
    const returnToMobileList = useCallback(() => {
        setMobileView("list");
        if (activeTab === "contacts") {
            setShowContactMenu(false);
            setShowRemoveContactConfirm(false);
            setActiveContact(null);
            setRestoredActiveContactId(null);
        }
        if (activeTab === "settings") {
            setSettingsDetail("none");
        }
    }, [activeTab]);
    const openPrimaryTab = useCallback((tab: "chat" | "notebook" | "contacts" | "files" | "tasks" | "settings" | "account") => {
        setMobileView("list");
        setActiveTab(tab);
        if (tab === "settings") {
            setSettingsDetail("none");
        }
    }, []);
    const pluginRuntimeContextValue = useMemo(() => ({
        userType,
        matrixUserId: matrixCredentials?.user_id ?? null,
        matrixUserLocalId: formatMatrixUserLocalId(matrixCredentials?.user_id),
        matrixHomeServer: matrixCredentials?.hs_url ?? null,
        hasHubSession: Boolean(hubSession?.access_token),
        platformManaged: true,
    }), [hubSession?.access_token, matrixCredentials?.hs_url, matrixCredentials?.user_id, userType]);
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
    const [checkingDesktopUpdate, setCheckingDesktopUpdate] = useState(false);
    const [desktopUpdaterVersion, setDesktopUpdaterVersion] = useState<string | null>(null);
    const pushToast = useToastStore((state) => state.pushToast);
    const desktopUpdaterAvailable = useMemo(() => isTauriDesktop(), []);
    const notebookBootNoticeRef = useRef<string | null>(null);
    const taskTokenExpired = hubSessionExpiresAt ? hubSessionExpiresAt * 1000 <= Date.now() : false;
    const taskAccessToken = !taskTokenExpired && hubAccessToken ? hubAccessToken : matrixAccessToken;
    const taskHsUrl = !taskTokenExpired && hubAccessToken ? null : matrixHsUrl;
    const workspaceCacheKey = useMemo(() => {
        const userId = matrixCredentials?.user_id ?? "";
        if (!userId) return null;
        return `${WORKSPACE_CACHE_PREFIX}${userId}`;
    }, [matrixCredentials?.user_id]);
    const notebookApiBaseUrlCacheKey = useMemo(() => {
        const userId = matrixCredentials?.user_id ?? "";
        if (!userId) return null;
        return `${NOTEBOOK_API_BASE_URL_CACHE_PREFIX}${userId}`;
    }, [matrixCredentials?.user_id]);
    const notebookCapabilitiesCacheKey = useMemo(() => {
        const userId = matrixCredentials?.user_id ?? "";
        if (!userId) return null;
        return `${NOTEBOOK_CAPABILITIES_CACHE_PREFIX}${userId}`;
    }, [matrixCredentials?.user_id]);
    const tasksReady = deferredModules.tasks || activeTab === "tasks";
    const filesReady = deferredModules.files || activeTab === "files";
    const notebookReady = deferredModules.notebook || activeTab === "notebook";

    useEffect(() => {
        if (!matrixCredentials?.user_id) {
            setDeferredModules({
                tasks: false,
                files: false,
                notebook: false,
            });
            return;
        }

        setDeferredModules({
            tasks: false,
            files: false,
            notebook: false,
        });

        if (!shouldWarmDeferredModules) {
            return;
        }

        const tasksTimer = window.setTimeout(() => {
            setDeferredModules((prev) => ({ ...prev, tasks: true }));
        }, TASKS_WARMUP_DELAY_MS);
        const filesTimer = window.setTimeout(() => {
            setDeferredModules((prev) => ({ ...prev, files: true }));
        }, FILES_WARMUP_DELAY_MS);
        const notebookTimer = window.setTimeout(() => {
            setDeferredModules((prev) => ({ ...prev, notebook: true }));
        }, NOTEBOOK_WARMUP_DELAY_MS);

        return () => {
            window.clearTimeout(tasksTimer);
            window.clearTimeout(filesTimer);
            window.clearTimeout(notebookTimer);
        };
    }, [matrixCredentials?.user_id, shouldWarmDeferredModules]);

    useEffect(() => {
        let disposed = false;

        const applyCachedState = (cached: PersistedWorkspaceState | null): void => {
            if (!cached || disposed) return;
            if (isWindowsDesktop) {
                setActiveTab("chat");
                setActiveRoomId(null);
                setSelectedFileRoomId(null);
                setRestoredActiveContactId(null);
                return;
            }
            if (cached.activeTab) {
                setActiveTab(cached.activeTab);
            }
            if (typeof cached.activeRoomId !== "undefined") {
                setActiveRoomId(cached.activeRoomId ?? null);
            }
            if (typeof cached.selectedFileRoomId !== "undefined") {
                setSelectedFileRoomId(cached.selectedFileRoomId ?? null);
            }
            if (typeof cached.activeContactId !== "undefined") {
                setRestoredActiveContactId(cached.activeContactId ?? null);
            }
        };

        applyCachedState(readWorkspaceState(workspaceCacheKey));

        void readWorkspaceStateFromSqlite<PersistedWorkspaceState>(matrixCredentials?.user_id ?? null, WORKSPACE_CACHE_TTL_MS)
            .then((cached) => {
                applyCachedState(cached);
            })
            .catch(() => undefined);

        return () => {
            disposed = true;
        };
    }, [matrixCredentials?.user_id, workspaceCacheKey]);

    useEffect(() => {
        const cachedNotebookApiBaseUrl = userType === "staff"
            ? null
            : readNotebookBootCache<string>(notebookApiBaseUrlCacheKey);
        const cachedCapabilities = readNotebookBootCache<string[]>(notebookCapabilitiesCacheKey);

        setNotebookApiBaseUrlOverride(cachedNotebookApiBaseUrl);
        setCapabilityValues(Array.isArray(cachedCapabilities) ? cachedCapabilities : []);
        setCapabilityLoaded(Array.isArray(cachedCapabilities) && cachedCapabilities.length > 0);
        setCapabilityError(null);
    }, [notebookApiBaseUrlCacheKey, notebookCapabilitiesCacheKey]);

    useEffect(() => {
        const payload = {
            activeTab,
            activeRoomId,
            selectedFileRoomId,
            activeContactId:
                activeTab === "contacts" && mobileView === "detail"
                    ? (activeContact?.id ?? restoredActiveContactId)
                    : null,
        } satisfies PersistedWorkspaceState;

        if (workspaceCacheKey && typeof window !== "undefined") {
            try {
                window.localStorage.setItem(workspaceCacheKey, JSON.stringify(payload));
            } catch {
                // ignore workspace cache write failures
            }
        }

        void writeWorkspaceStateToSqlite(matrixCredentials?.user_id ?? null, payload);
    }, [activeContact?.id, activeRoomId, activeTab, matrixCredentials?.user_id, mobileView, restoredActiveContactId, selectedFileRoomId, workspaceCacheKey]);

    useEffect(() => {
        if (activeTab === "tasks" && !deferredModules.tasks) {
            setDeferredModules((prev) => ({ ...prev, tasks: true }));
        } else if (activeTab === "files" && !deferredModules.files) {
            setDeferredModules((prev) => ({ ...prev, files: true }));
        } else if (activeTab === "notebook" && !deferredModules.notebook) {
            setDeferredModules((prev) => ({ ...prev, notebook: true }));
        }
    }, [activeTab, deferredModules.files, deferredModules.notebook, deferredModules.tasks]);

    useEffect(() => {
        if (!isWindowsDesktop) return;
        let cancelled = false;
        const revealShell = (): void => {
            if (cancelled) return;
            setShellReady(true);
            window.setTimeout(() => {
                if (!cancelled) {
                    setRoomListMounted(true);
                }
            }, 180);
        };
        revealShell();
        return () => {
            cancelled = true;
        };
    }, [isWindowsDesktop]);
    const meUpdateToken = hubAccessToken && !localeTokenExpired ? hubAccessToken : null;
    const meUpdateOptions = undefined;
    const [capabilityValues, setCapabilityValues] = useState<string[]>([]);
    const [capabilityLoaded, setCapabilityLoaded] = useState(false);
    const [capabilityError, setCapabilityError] = useState<string | null>(null);
    const [refreshingNotebookToken, setRefreshingNotebookToken] = useState(false);
    const notebookRefreshBackoffUntilRef = useRef(0);
    const notebookRefreshFailureCountRef = useRef(0);
    const notebookRefreshFlightRef = useRef<Promise<string | null> | null>(null);
    const notebookRefreshFlightTimerRef = useRef<number | null>(null);
    const notebookUserSubRef = useRef<string | null>(parseJwtSub(hubSession?.access_token));
    const [capabilityRefreshSeq, setCapabilityRefreshSeq] = useState(0);
    const [capabilityTokenRefreshSeq, setCapabilityTokenRefreshSeq] = useState(0);
    const shouldWaitForNotebookMeBootstrap = userType === "staff";
    const resolvedNotebookApiBaseUrl = userType === "staff"
        ? (hubMeResolved ? (notebookApiBaseUrlOverride ?? null) : null)
        : (shouldWaitForNotebookMeBootstrap && !hubMeResolved
            ? null
            : notebookApiBaseUrlOverride ?? configuredNotebookApiBaseUrl ?? null);
    const { notebookAuth, notebookToken } = useMemo(() => buildNotebookAuth({
        hubSession,
        matrixCredentials,
        userType,
        capabilities: capabilityValues,
        apiBaseUrl: resolvedNotebookApiBaseUrl,
    }), [capabilityValues, hubSession, matrixCredentials, resolvedNotebookApiBaseUrl, userType]);
    const effectiveNotebookApiBaseUrl = resolvedNotebookApiBaseUrl;
    const notebookWorkspaceAuth = useMemo(() => {
        const matrixUserId = matrixCredentials?.user_id?.trim();
        if (!matrixUserId || !notebookAuth?.accessToken) {
            return null;
        }
        return {
            accessToken: notebookAuth.accessToken,
            matrixAccessToken: matrixCredentials?.access_token ?? null,
            apiBaseUrl: effectiveNotebookApiBaseUrl,
            hsUrl: matrixCredentials?.hs_url ?? null,
            matrixUserId,
            userType,
            capabilities: capabilityValues,
        };
    }, [
        capabilityValues,
        matrixCredentials?.access_token,
        matrixCredentials?.hs_url,
        matrixCredentials?.user_id,
        effectiveNotebookApiBaseUrl,
        notebookAuth,
        userType,
    ]);
    const capabilityToken = notebookToken.accessToken;
    const notebookCapabilityState = useMemo(
        () =>
            resolveNotebookCapabilities({
                userType,
                capabilities: capabilityValues,
                loaded: capabilityLoaded,
            }),
        [capabilityLoaded, capabilityValues, userType],
    );
    const hasNotebookLocalWorkspace = Boolean(matrixCredentials?.user_id);
    const notebookWorkspaceVisible = hasNotebookLocalWorkspace;
    const notebookWorkspaceAvailable = Boolean(notebookWorkspaceAuth?.matrixUserId);
    useEffect(() => {
        if (!desktopUpdaterAvailable) return;

        let cancelled = false;
        void getDesktopUpdaterStatus()
            .then((status) => {
                if (cancelled) return;
                setDesktopUpdaterVersion(status.currentVersion || null);
            })
            .catch((error) => {
                console.warn("Failed to load desktop updater status:", error);
            });

        return () => {
            cancelled = true;
        };
    }, [desktopUpdaterAvailable]);


    useEffect(() => {
        if (!desktopUpdaterAvailable || !hubMeResolved || !capabilityLoaded || !capabilityError) return;
        if (notebookBootNoticeRef.current === capabilityError) return;
        notebookBootNoticeRef.current = capabilityError;
        pushToast("warn", capabilityError, 5000);
    }, [capabilityError, capabilityLoaded, desktopUpdaterAvailable, hubMeResolved, pushToast]);

    const clearLocalAuthSession = useCallback((): void => {
        clearSession();
        void import("../api/supabase").then(({ getSupabaseClient }) =>
            getSupabaseClient()
                .auth.signOut({ scope: "local" })
                .catch(() => {
                    // ignore local sign-out failures during session cleanup
                }),
        );
    }, [clearSession]);

    const onLogout = useCallback((): void => {
        clearLocalAuthSession();
        navigate("/auth", { replace: true });
    }, [clearLocalAuthSession, navigate]);

    const notebookTerminalLogoutHandledRef = useRef(false);
    useEffect(() => {
        notebookTerminalLogoutHandledRef.current = false;
    }, [hubSession?.access_token, matrixCredentials?.user_id]);

    const triggerNotebookTerminalLogout = useCallback((signal: NotebookTerminalAuthFailureSignal): void => {
        if (notebookTerminalLogoutHandledRef.current) return;
        if (!isNotebookTerminalAuthFailure(signal)) return;
        notebookTerminalLogoutHandledRef.current = true;
        onLogout();
    }, [onLogout]);

    const resolveAvatarUrl = useCallback((mxcUrl: string | null | undefined): string | null => {
        if (!matrixClient || !mxcUrl) return null;
        return matrixClient.mxcUrlToHttp(mxcUrl, 96, 96, "crop") ?? matrixClient.mxcUrlToHttp(mxcUrl) ?? null;
    }, [matrixClient]);
    useEffect(() => {
        notebookUserSubRef.current = parseJwtSub(hubSession?.access_token);
    }, [hubSession?.access_token]);

    useEffect(() => {
        if (!userType || !matrixCredentials) return;

        let active = true;
        let unsubscribe: (() => void) | undefined;

        const syncStoreFromSession = (
            nextSession: {
                access_token?: string | null;
                refresh_token?: string | null;
                expires_at?: number | null;
            } | null | undefined,
        ): void => {
            if (!active) return;
            const normalized = toStoredHubSession(nextSession, hubSession?.refresh_token);
            if (!normalized) return;
            if (
                normalized.access_token === hubSession?.access_token
                && normalized.refresh_token === (hubSession?.refresh_token || "")
                && normalized.expires_at === hubSession?.expires_at
            ) {
                return;
            }
            setHubSession(normalized);
        };

        void import("../api/supabase").then(({ getSupabaseClient }) => {
            if (!active) return;
            const supabase = getSupabaseClient();

            void supabase.auth.getSession().then(({ data, error }) => {
                if (!active || error) return;
                if (data.session?.access_token) {
                    syncStoreFromSession(data.session);
                    return;
                }
                if (!hubSession?.access_token || !hubSession.refresh_token) return;
                void supabase.auth.setSession({
                    access_token: hubSession.access_token,
                    refresh_token: hubSession.refresh_token,
                }).catch(() => {
                    // ignore bootstrap sync failures; request-level refresh handles recovery
                });
            });

            const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
                syncStoreFromSession(nextSession);
            });
            unsubscribe = () => data.subscription.unsubscribe();
        });

        return () => {
            active = false;
            unsubscribe?.();
        };
    }, [
        hubSession?.access_token,
        hubSession?.expires_at,
        hubSession?.refresh_token,
        matrixCredentials,
        setHubSession,
        userType,
    ]);

    const refreshNotebookToken = useCallback(async (options?: { force?: boolean }): Promise<string | null> => {
        if (!hubSession?.refresh_token) return null;
        if (!options?.force && Date.now() < notebookRefreshBackoffUntilRef.current) return null;
        if (notebookRefreshFlightRef.current) return notebookRefreshFlightRef.current;

        const flight = (async (): Promise<string | null> => {
            setRefreshingNotebookToken(true);
            try {
                const { getSupabaseClient } = await import("../api/supabase");
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
                    triggerNotebookTerminalLogout({
                        code: "INVALID_AUTH_TOKEN",
                        status: 401,
                        terminal: true,
                    });
                    return null;
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
                return data.session.access_token;
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
                const isAuthFailure =
                    status === 401
                    || message === "INVALID_AUTH_TOKEN"
                    || message.includes("Invalid Refresh Token")
                    || message.includes("NO_VALID_HUB_TOKEN")
                    || message.includes("INVALID_TOKEN_TYPE");
                if (isAuthFailure) {
                    triggerNotebookTerminalLogout({
                        code: "INVALID_AUTH_TOKEN",
                        status: 401,
                        terminal: true,
                    });
                    return null;
                }
                setCapabilityError(isRateLimited ? t("layout.notebook.systemBusy") : t("layout.notebook.capabilityLoadFailed"));
                return null;
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
    }, [hubSession?.refresh_token, hubSession?.access_token, setHubSession, t, triggerNotebookTerminalLogout]);

    const buildNotebookAuthWithAccessToken = useCallback((accessToken: string) => {
        return buildNotebookAuth({
            hubSession: {
                access_token: accessToken,
                refresh_token: hubSession?.refresh_token || "",
                expires_at: hubSession?.expires_at,
            },
            matrixCredentials,
            userType,
            capabilities: capabilityValues,
            apiBaseUrl: resolvedNotebookApiBaseUrl,
        }).notebookAuth;
    }, [
        capabilityValues,
        hubSession?.expires_at,
        hubSession?.refresh_token,
        matrixCredentials,
        resolvedNotebookApiBaseUrl,
        userType,
    ]);

    const runHubSessionRequest = useCallback(async <T,>(
        runner: (accessToken: string) => Promise<T>,
    ): Promise<T> => {
        if (!hubAccessToken) {
            throw new Error("Missing hub access token");
        }
        try {
            return await runner(hubAccessToken);
        } catch (error) {
            if (!isHubAuthFailure(error)) {
                throw error;
            }
            const refreshedAccessToken = await refreshNotebookToken({ force: true });
            if (!refreshedAccessToken) {
                throw error;
            }
            return runner(refreshedAccessToken);
        }
    }, [hubAccessToken, refreshNotebookToken]);

    const runNotebookAuthedRequest = useCallback(async <T,>(
        runner: (auth: NonNullable<typeof notebookAuth>) => Promise<T>,
    ): Promise<T> => {
        if (!notebookAuth) {
            throw new Error("Missing notebook auth");
        }
        try {
            return await runner(notebookAuth);
        } catch (error) {
            if (!isNotebookAuthFailure(error)) {
                throw error;
            }
            const refreshedAccessToken = await refreshNotebookToken({ force: true });
            if (!refreshedAccessToken) {
                throw error;
            }
            const refreshedAuth = buildNotebookAuthWithAccessToken(refreshedAccessToken);
            if (!refreshedAuth) {
                throw error;
            }
            return runner(refreshedAuth);
        }
    }, [buildNotebookAuthWithAccessToken, notebookAuth, refreshNotebookToken]);

    const retryNotebookCapability = useCallback(() => {
        notebookRefreshBackoffUntilRef.current = 0;
        notebookRefreshFailureCountRef.current = 0;
        setCapabilityRefreshSeq((prev) => prev + 1);
        void refreshNotebookToken({ force: true });
    }, [refreshNotebookToken]);

    useEffect(() => {
        if (!notebookReady) return;
        if (
            notebookToken.reason !== "expired_hub_token" &&
            notebookToken.reason !== "missing_hub_token" &&
            notebookToken.reason !== "invalid_hub_token_format"
        ) {
            return;
        }
        if (!hubSession?.refresh_token || refreshingNotebookToken) return;
        void refreshNotebookToken();
    }, [hubSession?.refresh_token, notebookReady, notebookToken.reason, refreshNotebookToken, refreshingNotebookToken]);
    useEffect(() => {
        if (!notebookReady) return;
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
    }, [hubSession?.refresh_token, notebookReady, notebookToken.reason, refreshNotebookToken, refreshingNotebookToken]);

    const handleDisplayLanguageChange = async (value: string): Promise<void> => {
        const previous = displayLanguage;
        setDisplayLanguage(value);
        if (isSupportedDisplayLanguage(value)) {
            setLanguage(value);
        }
        try {
            if (userType === "client" && meUpdateToken) {
                const { hubMeUpdateLocale } = await import("../api/hub");
                await hubMeUpdateLocale(meUpdateToken, value, meUpdateOptions);
            } else if (userType === "staff" && matrixAccessToken && matrixHsUrl) {
                const { updateStaffLanguage } = await import("../api/profile");
                await updateStaffLanguage(matrixAccessToken, matrixHsUrl, value);
            }
        } catch {
            setDisplayLanguage(previous);
            if (isSupportedDisplayLanguage(previous)) {
                setLanguage(previous);
            }
        }
    };

    const handleChatReceiveLanguageChange = async (value: string): Promise<void> => {
        const previous = chatReceiveLanguage;
        setChatReceiveLanguageSaving(true);
        setChatReceiveLanguage(value);
        try {
            if (userType === "client" && meUpdateToken) {
                const { hubMeUpdateTranslationLocale } = await import("../api/hub");
                await hubMeUpdateTranslationLocale(meUpdateToken, value, meUpdateOptions);
                setMeProfile((prev) => (prev ? { ...prev, translation_locale: value } : prev));
            } else if (userType === "staff" && matrixAccessToken && matrixHsUrl) {
                const { updateStaffTranslationLanguage } = await import("../api/profile");
                await updateStaffTranslationLanguage(matrixAccessToken, matrixHsUrl, value);
            }
        } catch {
            setChatReceiveLanguage(previous);
        } finally {
            setChatReceiveLanguageSaving(false);
        }
    };

    const handleSubmitDisplayName = useCallback(async (): Promise<void> => {
        if (!matrixClient || !matrixCredentials?.user_id) return;
        const trimmed = displayNameDraft.trim();
        if (!trimmed) {
            setAccountEditorError(t("layout.accountNameRequired", "Please enter a name."));
            setAccountEditorSuccess(null);
            return;
        }
        setAccountEditorBusy(true);
        setAccountEditorError(null);
        setAccountEditorSuccess(null);
        try {
            await matrixClient.setDisplayName(trimmed);
            setAccountEditorSuccess(t("layout.accountNameUpdated", "Name updated."));
            setMeProfile((prev) => (prev ? { ...prev, display_name: trimmed } : prev));
            setAccountEditorMode("none");
        } catch (error) {
            setAccountEditorError(error instanceof Error ? error.message : t("layout.accountUpdateFailed", "Update failed."));
        } finally {
            setAccountEditorBusy(false);
        }
    }, [displayNameDraft, matrixClient, matrixCredentials?.user_id, t]);

    const handleSubmitPassword = useCallback(async (): Promise<void> => {
        if (!matrixCredentials?.hs_url || !matrixCredentials?.access_token || !matrixCredentials?.user_id) return;
        if (!currentPasswordDraft.trim() || !newPasswordDraft.trim() || !confirmPasswordDraft.trim()) {
            setAccountEditorError(t("auth.errors.emptyPassword"));
            setAccountEditorSuccess(null);
            return;
        }
        if (newPasswordDraft !== confirmPasswordDraft) {
            setAccountEditorError(t("auth.errors.passwordMismatch"));
            setAccountEditorSuccess(null);
            return;
        }
        const hasLetters = /[A-Za-z]/.test(newPasswordDraft);
        const hasDigits = /\d/.test(newPasswordDraft);
        if (newPasswordDraft.length < 10 || !hasLetters || !hasDigits) {
            setAccountEditorError(t("auth.errors.passwordWeak"));
            setAccountEditorSuccess(null);
            return;
        }
        setAccountEditorBusy(true);
        setAccountEditorError(null);
        setAccountEditorSuccess(null);
        try {
            await changeMatrixPassword(
                matrixCredentials.hs_url,
                matrixCredentials.access_token,
                matrixCredentials.user_id,
                currentPasswordDraft,
                newPasswordDraft,
            );
            setAccountEditorSuccess(t("layout.accountPasswordUpdated", "Password updated."));
            setCurrentPasswordDraft("");
            setNewPasswordDraft("");
            setConfirmPasswordDraft("");
            setAccountEditorMode("none");
        } catch (error) {
            setAccountEditorError(error instanceof Error ? error.message : t("layout.accountUpdateFailed", "Update failed."));
        } finally {
            setAccountEditorBusy(false);
        }
    }, [
        confirmPasswordDraft,
        currentPasswordDraft,
        matrixCredentials?.access_token,
        matrixCredentials?.hs_url,
        matrixCredentials?.user_id,
        newPasswordDraft,
        t,
    ]);

    useEffect(() => {
        if (!shellReady || matrixClient || !matrixCredentials) return;
        void ensureMatrixClient();
    }, [ensureMatrixClient, matrixClient, matrixCredentials, shellReady]);

    useEffect(() => {
        if (!shellReady || !matrixClient) return undefined;
        let cancelled = false;

        void import("../matrix/client").then(({ prepareMatrixClient }) =>
            prepareMatrixClient(matrixClient).finally(() => {
                if (cancelled) return;
                matrixClient.startClient({
                    initialSyncLimit: MATRIX_INITIAL_SYNC_LIMIT,
                    lazyLoadMembers: true,
                });
            }),
        );

        return () => {
            cancelled = true;
            matrixClient.stopClient();
        };
    }, [matrixClient, shellReady]);

    useEffect(() => {
        if (!matrixClient || !matrixCredentials?.user_id) return undefined;
        const myUserId = matrixCredentials.user_id;
        const shownForRoom = new Set<string>();

        const onMyMembership = (room: Room, membership: string, prevMembership?: string): void => {
            if (!room) return;
            if (membership !== "leave" && membership !== "ban") return;
            if (prevMembership !== "join" && prevMembership !== "invite") return;
            if (shownForRoom.has(room.roomId)) return;
            const selfMemberEvent = room.currentState.getStateEvents(MATRIX_EVENT_TYPE_ROOM_MEMBER, myUserId);
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

        bindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_MY_MEMBERSHIP, onMyMembership);
        return () => {
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_MY_MEMBERSHIP, onMyMembership);
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
            if (event.getType() !== MATRIX_EVENT_TYPE_ROOM_MEMBER) return;
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

        bindMatrixRuntimeEvent(matrixClient, MATRIX_CLIENT_EVENT_SYNC, onSync);
        bindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_MY_MEMBERSHIP, onMyMembership);
        bindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_TIMELINE, onTimeline);
        return () => {
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_CLIENT_EVENT_SYNC, onSync);
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_MY_MEMBERSHIP, onMyMembership);
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_TIMELINE, onTimeline);
        };
    }, [matrixClient, matrixCredentials?.user_id, activeRoomId]);

    useEffect(() => {
        traceEvent("ui.active_room_changed", { activeRoomId: activeRoomId ?? null, activeTab });
    }, [activeRoomId, activeTab]);

    useEffect(() => {
        if (activeTab === "notebook") {
            setNotebookRefreshToken((prev) => prev + 1);
        }
    }, [activeTab]);

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
                const { hubGetMe } = await import("../api/hub");
                const response = await runHubSessionRequest((accessToken) => hubGetMe({
                    accessToken,
                    hsUrl: matrixHsUrl,
                    matrixUserId: matrixCredentials?.user_id,
                }));
                if (!isActive) return;
                setMeProfile(response.profile);
                setNotebookApiBaseUrlOverride(response.notebook_api_base_url ?? null);
                writeNotebookBootCache(notebookApiBaseUrlCacheKey, response.notebook_api_base_url ?? null);
                if (response.profile?.locale) {
                    setDisplayLanguage(response.profile.locale);
                    if (isSupportedDisplayLanguage(response.profile.locale)) {
                        setLanguage(response.profile.locale);
                    }
                }
                if (response.profile?.translation_locale) {
                    setChatReceiveLanguage(response.profile.translation_locale);
                }
            } catch {
                if (!isActive) return;
                setMeProfile(null);
                setNotebookApiBaseUrlOverride(null);
                writeNotebookBootCache(notebookApiBaseUrlCacheKey, null);
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
    }, [hubAccessToken, matrixHsUrl, matrixCredentials?.user_id, notebookApiBaseUrlCacheKey, runHubSessionRequest]);

    useEffect(() => {
        if (!notebookReady) {
            setNotebookUploadLimitMb(20);
            return;
        }
        if (!notebookAuth || !effectiveNotebookApiBaseUrl) {
            setNotebookUploadLimitMb(20);
            return;
        }
        let alive = true;
        void import("../services/notebookApi").then(({ getCompanyNotebookAiSettings }) =>
            runNotebookAuthedRequest((auth) => getCompanyNotebookAiSettings(auth)))
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
    }, [effectiveNotebookApiBaseUrl, notebookAuth, notebookReady, runNotebookAuthedRequest]);

    useEffect(() => {
        if (!notebookReady) {
            setCapabilityError(null);
            return;
        }
        if (!capabilityToken) {
            if (
                notebookToken.reason === "expired_hub_token" ||
                notebookToken.reason === "missing_hub_token" ||
                notebookToken.reason === "invalid_hub_token_format"
            ) {
                if (hubSession?.refresh_token) {
                    setCapabilityLoaded(false);
                    if (!refreshingNotebookToken) {
                        void refreshNotebookToken();
                    }
                    return;
                }
                triggerNotebookTerminalLogout({
                    code: notebookToken.reason === "missing_hub_token"
                        ? "NO_VALID_HUB_TOKEN"
                        : notebookToken.reason === "invalid_hub_token_format"
                            ? "INVALID_TOKEN_TYPE"
                            : "INVALID_AUTH_TOKEN",
                    status: 401,
                    terminal: true,
                });
                return;
            }
            setCapabilityLoaded(true);
            setCapabilityValues([]);
            triggerNotebookTerminalLogout({
                code: "INVALID_AUTH_TOKEN",
                status: 401,
                terminal: true,
            });
            return;
        }
        if (!hubMeResolved) {
            setCapabilityLoaded(false);
            setCapabilityError(null);
            return;
        }
        if (!effectiveNotebookApiBaseUrl) {
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
        void import("../services/notebookApi").then(({ getNotebookCapabilities }) =>
            runNotebookAuthedRequest((auth) => getNotebookCapabilities({
                accessToken: auth.accessToken,
                apiBaseUrl: auth.apiBaseUrl,
                hsUrl: auth.hsUrl,
                matrixUserId: auth.matrixUserId,
            }))).then((result) => {
            if (!alive) return;
            const values = Array.isArray(result.capabilities)
                ? result.capabilities.filter((value): value is string => typeof value === "string")
                : [];
            setCapabilityValues(values);
            setCapabilityLoaded(true);
            setCapabilityError(null);
            writeNotebookBootCache(notebookCapabilitiesCacheKey, values);
        }).catch((error) => {
            if (!alive) return;
            console.error("Notebook capability load failed", {
                error,
                status: error instanceof NotebookServiceError ? error.status : null,
                code: error instanceof NotebookServiceError ? error.code : null,
                message: error instanceof Error ? error.message : String(error),
                notebookApiBaseUrlOverride: effectiveNotebookApiBaseUrl,
                matrixHsUrl,
                matrixUserId: matrixCredentials?.user_id ?? null,
            });
            const hasCachedCapabilities = capabilityValues.length > 0;
            if (hasCachedCapabilities) {
                setCapabilityLoaded(true);
                setCapabilityError(null);
                return;
            }
            setCapabilityValues([]);
            setCapabilityLoaded(true);
            if (error instanceof NotebookServiceError) {
                if (
                    error.code === "NO_VALID_HUB_TOKEN" ||
                    error.code === "INVALID_AUTH_TOKEN" ||
                    error.code === "INVALID_TOKEN_TYPE" ||
                    error.status === 401
                ) {
                    triggerNotebookTerminalLogout({
                        code: error.code,
                        status: error.status,
                        terminal: true,
                    });
                    return;
                }
                if (error.code === "CAPABILITY_DISABLED") {
                    writeNotebookBootCache(notebookCapabilitiesCacheKey, null);
                    setCapabilityError(t("layout.notebook.capabilityDisabled"));
                    return;
                }
                if (error.code === "CAPABILITY_EXPIRED") {
                    writeNotebookBootCache(notebookCapabilitiesCacheKey, null);
                    setCapabilityError(t("layout.notebook.capabilityExpired"));
                    return;
                }
                if (error.code === "QUOTA_EXCEEDED") {
                    setCapabilityError(t("layout.notebook.quotaExceeded"));
                    return;
                }
                if (error.status >= 500) {
                    if (isTauriDesktop()) {
                        setCapabilityError(
                            `Notebook ${error.status} ${error.code}: ${error.message} @ ${effectiveNotebookApiBaseUrl || "no-base-url"}`,
                        );
                        return;
                    }
                    setCapabilityError(`${t("layout.notebook.systemBusy")} (${error.code} / HTTP ${error.status})`);
                    return;
                }
            }
            if (isTauriDesktop() && error instanceof Error) {
                setCapabilityError(
                    `Notebook init failed: ${error.message} @ ${effectiveNotebookApiBaseUrl || "no-base-url"}`,
                );
                return;
            }
            if (error instanceof Error && !isTauriDesktop()) {
                setCapabilityError(`${t("layout.notebook.capabilityLoadFailed")} (${error.message})`);
                return;
            }
            setCapabilityError(t("layout.notebook.capabilityLoadFailed"));
        });
        return () => {
            alive = false;
        };
    }, [capabilityRefreshSeq, capabilityToken, capabilityTokenRefreshSeq, capabilityValues.length, effectiveNotebookApiBaseUrl, hubMeResolved, hubSession?.refresh_token, matrixCredentials?.user_id, matrixHsUrl, notebookCapabilitiesCacheKey, notebookReady, notebookToken.reason, refreshNotebookToken, refreshingNotebookToken, runNotebookAuthedRequest, t, triggerNotebookTerminalLogout, userType]);

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
        if (raw === "original" || raw === "translated" || raw === "bilingual") {
            setTranslationDefaultView(raw);
            return;
        }
        setTranslationDefaultView("translated");
    }, [translationDefaultStorageKey]);

    useEffect(() => {
        localStorage.setItem(translationDefaultStorageKey, translationDefaultView);
    }, [translationDefaultStorageKey, translationDefaultView]);

    useEffect(() => {
        setNotificationSoundHydrated(false);
        if (isTauriMobile() && resolveRuntimePlatform() === "ios") {
            setNotificationSoundMode("off");
            setNotificationSoundHydrated(true);
            return;
        }
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
        if (activeTab !== "contacts") {
            setActiveContact(null);
            setShowContactMenu(false);
        }
        setSettingsDetail("none");
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === "contacts" && mobileView === "list" && activeContact) {
            setActiveContact(null);
        }
    }, [activeContact, activeTab, mobileView]);

    useEffect(() => {
        const panel = mainPanelRef.current;
        if (!panel || mobileView !== "detail") return undefined;

        let startX = 0;
        let startY = 0;
        let tracking = false;

        const onTouchStart = (event: TouchEvent): void => {
            const touch = event.touches[0];
            if (!touch) return;
            startX = touch.clientX;
            startY = touch.clientY;
            tracking = touch.clientX <= 28;
        };

        const onTouchEnd = (event: TouchEvent): void => {
            if (!tracking) return;
            tracking = false;
            const touch = event.changedTouches[0];
            if (!touch) return;
            const deltaX = touch.clientX - startX;
            const deltaY = Math.abs(touch.clientY - startY);
            if (deltaX >= 72 && deltaY <= 40) {
                returnToMobileList();
            }
        };

        panel.addEventListener("touchstart", onTouchStart, { passive: true });
        panel.addEventListener("touchend", onTouchEnd, { passive: true });
        return () => {
            panel.removeEventListener("touchstart", onTouchStart);
            panel.removeEventListener("touchend", onTouchEnd);
        };
    }, [mobileView, returnToMobileList]);

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

        bindMatrixRuntimeEvent(matrixClient, MATRIX_CLIENT_EVENT_SYNC, onSync);
        bindMatrixRuntimeEvent(matrixClient, MATRIX_CLIENT_EVENT_EVENT, onEvent);
        return () => {
            alive = false;
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_CLIENT_EVENT_SYNC, onSync);
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_CLIENT_EVENT_EVENT, onEvent);
        };
    }, [matrixClient, matrixCredentials?.user_id, resolveAvatarUrl]);

    useEffect(() => {
        if (activeTab === "contacts") {
            setContactsRefreshToken((prev) => prev + 1);
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== "account") {
            setAccountEditorMode("none");
            setAccountEditorError(null);
            setAccountEditorSuccess(null);
            setAccountEditorBusy(false);
            return;
        }
        setDisplayNameDraft(meProfile?.display_name || accountId);
        setCurrentPasswordDraft("");
        setNewPasswordDraft("");
        setConfirmPasswordDraft("");
        setAccountEditorError(null);
        setAccountEditorSuccess(null);
    }, [activeTab, accountId, meProfile?.display_name]);

    useEffect(() => {
        if (
            activeTab === "notebook" &&
            !notebookWorkspaceVisible
        ) {
            setActiveTab("chat");
        }
    }, [activeTab, notebookWorkspaceVisible]);

    useEffect(() => {
        if (!matrixClient) return undefined;
        const onTimelineChanged = (): void => setFileLibraryTick((prev) => prev + 1);
        bindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_TIMELINE, onTimelineChanged);
        bindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_TIMELINE_RESET, onTimelineChanged);
        bindMatrixRuntimeEvent(matrixClient, MATRIX_CLIENT_EVENT_ROOM, onTimelineChanged);
        bindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_MY_MEMBERSHIP, onTimelineChanged);
        return () => {
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_TIMELINE, onTimelineChanged);
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_TIMELINE_RESET, onTimelineChanged);
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_CLIENT_EVENT_ROOM, onTimelineChanged);
            unbindMatrixRuntimeEvent(matrixClient, MATRIX_ROOM_EVENT_MY_MEMBERSHIP, onTimelineChanged);
        };
    }, [matrixClient]);

    useEffect(() => {
        if (!isNotificationSoundSupported()) return;
        const unlock = (): void => {
            ensureNotificationSoundEnabled({ userInitiated: true });
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

    useEffect(() => {
        let handled = false;
        const onSessionRevoked = (event: Event): void => {
            if (handled) return;
            const detail = (event as CustomEvent<HubSessionRevokedDetail>).detail;
            const revokedAccessToken = detail?.accessToken;
            if (revokedAccessToken && revokedAccessToken !== hubSession?.access_token) {
                return;
            }
            handled = true;
            clearLocalAuthSession();
            pushToast("warn", t("layout.sessionReplaced"), 5000, "center");
            navigate("/auth", { replace: true });
        };
        window.addEventListener(HUB_SESSION_REVOKED_EVENT, onSessionRevoked as EventListener);
        return () => {
            window.removeEventListener(HUB_SESSION_REVOKED_EVENT, onSessionRevoked as EventListener);
        };
    }, [clearLocalAuthSession, hubSession?.access_token, navigate, pushToast, t]);

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

    // runChatGlobalSearch moved to ChatSearchBar

    const onHideActiveRoom = async (): Promise<void> => {
        if (!matrixClient || !activeRoomId) return;
        const room = matrixClient.getRoom(activeRoomId);
        if (!room) return;
        try {
            const accountData = matrixClient.getAccountData(MATRIX_EVENT_TYPE_DIRECT as never);
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
                const { hideDirectRoom } = await import("../matrix/direct");
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

    const getDisplayLanguageLabel = (locale: string | null | undefined): string => {
        const normalized = String(locale || "").trim();
        if (!normalized) return t("common.placeholder");
        const match = displayLanguageOptions.find((option) => option.value === normalized);
        return match?.label ?? normalized;
    };
    const getTranslationLanguageLabel = (locale: string | null | undefined): string => {
        const normalized = String(locale || "").trim();
        if (!normalized) return t("common.placeholder");
        const match = translationLanguageOptions.find((option) => option.value === normalized);
        return match?.label ?? normalized;
    };

    const mobileNavItems = useMemo<AppShellNavItem[]>(() => {
        const items: AppShellNavItem[] = [
            {
                key: "contacts",
                icon: UserGroupIcon,
                active: activeTab === "contacts",
                badgeCount: inviteBadgeCount,
                label: t("roomList.sections.contacts"),
                onClick: () => openPrimaryTab("contacts"),
            },
            {
                key: "chat",
                icon: ChatBubbleLeftRightIcon,
                active: activeTab === "chat",
                badgeCount: unreadBadgeCount,
                label: t("main.sidebar.rooms"),
                onClick: () => openPrimaryTab("chat"),
            },
        ];

        if (notebookWorkspaceVisible) {
            items.push({
                key: "notebook",
                icon: BookOpenIcon,
                active: activeTab === "notebook",
                label: t("chat.notebook.panelTitle"),
                onClick: () => openPrimaryTab("notebook"),
            });
        }

        items.push(
            {
                key: "files",
                icon: FolderIcon,
                active: activeTab === "files",
                label: t("layout.filesTitle"),
                onClick: () => openPrimaryTab("files"),
            },
            {
                key: "tasks",
                icon: ClockIcon,
                active: activeTab === "tasks",
                label: t("tasks.title"),
                onClick: () => openPrimaryTab("tasks"),
            },
            ...pluginNavItems.map((item) => ({
                key: `plugin:${item.pluginId}:${item.id}`,
                icon: resolvePluginNavIcon(item.icon),
                active: false,
                badgeCount: item.badgeCount,
                label: item.label,
                onClick: () => item.onSelect?.(pluginRuntimeContextValue),
            })),
            {
                key: "settings",
                icon: Cog6ToothIcon,
                active: activeTab === "settings",
                label: t("layout.settings"),
                onClick: () => openPrimaryTab("settings"),
            },
        );

        return items;
    }, [activeTab, inviteBadgeCount, notebookWorkspaceVisible, openPrimaryTab, pluginNavItems, pluginRuntimeContextValue, t, unreadBadgeCount]);

    return (
        <div
            className={`flex min-h-0 w-full min-w-0 flex-col overflow-hidden bg-gray-100 font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 lg:flex-row ${
                isMobileApp ? "h-[100svh]" : "h-[100dvh]"
            }`}
        >
            <div className="border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">
                <div className="px-3 pb-4 pt-[calc(env(safe-area-inset-top,0px)+1.95rem)]">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => openPrimaryTab("account")}
                            className="mt-[0.2rem] inline-flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#2F5C56] text-sm font-bold text-white shadow-sm"
                            aria-label={t("layout.accountSettings")}
                        >
                            {accountAvatarUrl ? (
                                <img src={accountAvatarUrl} alt={accountId} className="h-full w-full object-cover" />
                            ) : (
                                accountInitial
                            )}
                        </button>
                        <div className="min-w-0 flex-1 overflow-x-auto pb-1.5 pt-[0.35rem]">
                            <div className="flex min-w-max items-center gap-2 pr-1">
                                {mobileNavItems.map((item) => (
                                    <MobileNavChip
                                        key={item.key}
                                        icon={item.icon}
                                        active={item.active}
                                        badgeCount={item.badgeCount}
                                        label={item.label}
                                        onClick={item.onClick}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 1. Leftmost Nav Bar (w-16, bg-gray-900) */}
            <nav className="hidden flex-shrink-0 items-center justify-between bg-gray-900 px-4 py-2 dark:bg-slate-900 lg:flex lg:w-16 lg:flex-col lg:justify-start lg:py-4">
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
                                    setMobileView("list");
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
                        label={t("roomList.sections.contacts")}
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
                        label={t("main.sidebar.rooms")}
                        onClick={() => {
                            setMobileView("list");
                            setActiveTab("chat");
                        }}
                        className="order-2 lg:order-none"
                    />
                    {notebookWorkspaceVisible && (
                        <NavBarItem
                            icon={BookOpenIcon}
                            active={activeTab === "notebook"}
                            label={t("chat.notebook.panelTitle")}
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
                        label={t("layout.filesTitle")}
                        onClick={() => {
                            setMobileView("list");
                            setActiveTab("files");
                        }}
                        className="order-4 lg:order-none"
                    />
                    <NavBarItem
                        icon={ClockIcon}
                        active={activeTab === "tasks"}
                        label={t("tasks.title")}
                        onClick={() => {
                            setMobileView("list");
                            setActiveTab("tasks");
                        }}
                        className="order-5 lg:order-none"
                    />
                    {pluginNavItems.map((item) => (
                        <NavBarItem
                            key={`${item.pluginId}:${item.id}`}
                            icon={resolvePluginNavIcon(item.icon)}
                            active={false}
                            badgeCount={item.badgeCount}
                            label={item.label}
                            onClick={() =>
                                item.onSelect?.({
                                    userType,
                                    matrixUserId: matrixCredentials?.user_id ?? null,
                                    matrixUserLocalId: formatMatrixUserLocalId(matrixCredentials?.user_id),
                                    matrixHomeServer: matrixCredentials?.hs_url ?? null,
                                    hasHubSession: Boolean(hubSession?.access_token),
                                    platformManaged: true,
                                })
                            }
                            className="lg:order-none"
                        />
                    ))}
                    <NavBarItem
                        icon={Cog6ToothIcon}
                        active={activeTab === "settings"}
                        label={t("layout.settings")}
                        onClick={() => {
                            setActiveTab("settings");
                            setSettingsDetail("none");
                            setMobileView("list");
                        }}
                        className="order-6 lg:order-none lg:hidden"
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
                className={`min-h-0 w-full flex-1 lg:flex-none bg-white border-r border-gray-200 flex flex-col flex-shrink-0 z-10 shadow-sm dark:bg-slate-900 dark:border-slate-800 lg:w-80 ${
                    activeTab === "tasks" || activeTab === "notebook" ? "hidden lg:hidden" : mobileView === "detail" ? "hidden lg:flex" : "flex"
                    }`}
            >
                {activeTab === "settings" || activeTab === "account" ? (
                    <Suspense fallback={null}>
                        <SettingsAccountSidebar
                            activeTab={activeTab}
                            displayLanguage={displayLanguage}
                            handleDisplayLanguageChange={handleDisplayLanguageChange}
                            setSettingsDetail={setSettingsDetail}
                            setMobileView={setMobileView}
                            notificationSoundMode={notificationSoundMode}
                            setNotificationSoundMode={setNotificationSoundMode}
                            pluginSettingsSections={pluginSettingsSections}
                            platformState={platformState}
                            desktopUpdaterAvailable={desktopUpdaterAvailable}
                            desktopUpdaterVersion={desktopUpdaterVersion}
                            checkingDesktopUpdate={checkingDesktopUpdate}
                            setCheckingDesktopUpdate={setCheckingDesktopUpdate}
                            checkDesktopUpdaterOnce={checkDesktopUpdaterOnce}
                            onLogout={onLogout}
                            accountAvatarUrl={accountAvatarUrl}
                            accountId={accountId}
                            accountInitial={accountInitial}
                            accountSubtitle={accountSubtitle}
                            meProfile={meProfile}
                            avatarUploading={avatarUploading}
                            avatarUploadFeedback={avatarUploadFeedback}
                            onUploadAvatar={onUploadAvatar}
                            accountEditorMode={accountEditorMode}
                            setAccountEditorMode={setAccountEditorMode}
                            displayNameDraft={displayNameDraft}
                            setDisplayNameDraft={setDisplayNameDraft}
                            currentPasswordDraft={currentPasswordDraft}
                            setCurrentPasswordDraft={setCurrentPasswordDraft}
                            newPasswordDraft={newPasswordDraft}
                            setNewPasswordDraft={setNewPasswordDraft}
                            confirmPasswordDraft={confirmPasswordDraft}
                            setConfirmPasswordDraft={setConfirmPasswordDraft}
                            accountEditorBusy={accountEditorBusy}
                            accountEditorError={accountEditorError}
                            setAccountEditorError={setAccountEditorError}
                            accountEditorSuccess={accountEditorSuccess}
                            setAccountEditorSuccess={setAccountEditorSuccess}
                            handleSubmitPassword={handleSubmitPassword}
                            handleSubmitDisplayName={handleSubmitDisplayName}
                            matrixCredentials={matrixCredentials}
                            getDisplayLanguageLabel={getDisplayLanguageLabel}
                            getTranslationLanguageLabel={getTranslationLanguageLabel}
                        />
                    </Suspense>
                ) : activeTab === "notebook" ? (
                    null
                ) : activeTab === "tasks" ? (
                    null
                ) : (
                    <>
                        <Suspense fallback={<div className="p-3" />}>
                            <ChatSearchBar
                                hubAccessToken={hubAccessToken}
                                matrixAccessToken={matrixAccessToken}
                                matrixHsUrl={matrixHsUrl}
                                matrixCredentials={matrixCredentials}
                                matrixClient={matrixClient}
                                runHubSessionRequest={runHubSessionRequest}
                                setActiveTab={(tab) => setActiveTab(tab as typeof activeTab)}
                                setActiveRoomId={setActiveRoomId}
                                setMobileView={setMobileView}
                                setJumpToEventId={setJumpToEventId}
                                activeTab={activeTab}
                                setShowCreateRoomModal={setShowCreateRoomModal}
                            />
                        </Suspense>

                        {/* Room List Content (Placeholder) */}
                        {roomListMounted ? (
                            <Suspense fallback={<div className="flex-1 min-h-0 bg-white dark:bg-slate-900" />}>
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
                                        setRestoredActiveContactId(contact?.id ?? null);
                                        setMobileView("detail");
                                    }}
                                    activeContactId={mobileView === "detail" ? (activeContact?.id ?? restoredActiveContactId) : null}
                                    contactsRefreshToken={contactsRefreshToken}
                                    pinnedRoomIds={pinnedRoomIds}
                                    enableContactPolling
                                    notificationSoundMode={notificationSoundMode}
                                />
                            </Suspense>
                        ) : (
                            <div className="flex-1 min-h-0 bg-white dark:bg-slate-900" />
                        )}
                    </>
                )}
            </aside>

            {/* 3. Chat Area (Flex-grow, bg-[#F2F4F7]) */}
            <main
                ref={mainPanelRef}
                className={`flex-1 min-h-0 flex flex-col bg-[#F2F4F7] relative min-w-0 dark:bg-slate-950 ${mobileView === "list" ? "hidden lg:flex" : "flex"
                    }`}
            >
                {/* Render nested routes (ChatRoom) here */}
                {activeTab === "contacts" ? (
                    <Suspense fallback={null}>
                        <ContactsPanel
                            matrixClient={matrixClient}
                            matrixCredentials={matrixCredentials}
                            activeContact={activeContact}
                            setActiveContact={setActiveContact}
                            showContactMenu={showContactMenu}
                            setShowContactMenu={setShowContactMenu}
                            showRemoveContactConfirm={showRemoveContactConfirm}
                            setShowRemoveContactConfirm={setShowRemoveContactConfirm}
                            setContactsRefreshToken={setContactsRefreshToken}
                            selectedSharedRoomId={selectedSharedRoomId}
                            setSelectedSharedRoomId={setSelectedSharedRoomId}
                            creatingContactRoom={creatingContactRoom}
                            setCreatingContactRoom={setCreatingContactRoom}
                            contactRoomActionError={contactRoomActionError}
                            setContactRoomActionError={setContactRoomActionError}
                            setActiveRoomId={setActiveRoomId}
                            setActiveTab={setActiveTab}
                            setMobileView={setMobileView}
                            getContactLabel={getContactLabel}
                            getContactAvatarUrl={getContactAvatarUrl}
                            returnToMobileList={returnToMobileList}
                            hubAccessToken={hubAccessToken}
                            hubSessionExpiresAt={hubSessionExpiresAt}
                        />
                    </Suspense>
                ) : activeTab === "files" ? (
                    <Suspense fallback={null}>
                        <FileCenterPanel
                            matrixClient={matrixClient}
                            matrixCredentials={matrixCredentials}
                            matrixAccessToken={matrixAccessToken}
                            selectedFileRoomId={selectedFileRoomId}
                            setSelectedFileRoomId={setSelectedFileRoomId}
                            setActiveRoomId={setActiveRoomId}
                            setActiveTab={setActiveTab}
                            setJumpToEventId={setJumpToEventId}
                            setMobileView={setMobileView}
                            fileLibraryTick={fileLibraryTick}
                            setFileLibraryTick={setFileLibraryTick}
                            filesReady={filesReady}
                            isMobileApp={isMobileApp}
                        />
                    </Suspense>
                ) : activeTab === "notebook" ? (
                    !notebookReady ? (
                        <DeferredModulePanel
                            title="Preparing notebook"
                            description="Local notebook cache is loading first, then recent changes will sync in the background."
                        />
                    ) : (
                        <Suspense fallback={<DeferredModulePanel
                            title="Preparing notebook"
                            description="Local notebook cache is loading first, then recent changes will sync in the background."
                        />}>
                            <NotebookPanel
                                auth={notebookWorkspaceAuth}
                                enabled={notebookReady && notebookWorkspaceAvailable && (!shouldWaitForNotebookMeBootstrap || hubMeResolved)}
                                refreshToken={notebookRefreshToken}
                                onAuthFailure={async () => refreshNotebookToken({ force: true })}
                                onTerminalAuthFailure={triggerNotebookTerminalLogout}
                                workspaceAvailable={notebookWorkspaceAvailable}
                                userType={userType}
                                matrixClient={matrixClient}
                                matrixCredentials={matrixCredentials}
                                matrixAccessToken={matrixCredentials?.access_token ?? null}
                                matrixHsUrl={matrixHsUrl}
                                hubAccessToken={hubAccessToken}
                                runHubSessionRequest={runHubSessionRequest}
                                uploadLimitMb={notebookUploadLimitMb}
                                pushToast={pushToast}
                                activeTab={activeTab}
                                fallback={<DeferredModulePanel
                                    title="Preparing notebook"
                                    description="Local notebook cache is loading first, then recent changes will sync in the background."
                                />}
                                onOpenPreview={(payload) => {
                                    setPreviewZoom(1);
                                    setPreviewOffset({ x: 0, y: 0 });
                                    setFilePreview(payload);
                                }}
                            />
                        </Suspense>
                    )
                ) : activeTab === "tasks" ? (
                    tasksReady ? (
                        <Suspense fallback={<DeferredModulePanel
                            title="Preparing tasks"
                            description="The task workspace is restoring local data before showing the latest task state."
                        />}>
                            <TaskWorkspaceDesktop
                                userId={matrixCredentials?.user_id ?? null}
                                activeRoomId={activeRoomId}
                                activeRoomName={(() => {
                                    if (!activeRoomId || !matrixClient) return null;
                                    const room = matrixClient.getRoom(activeRoomId);
                                    if (!room) return null;
                                    return resolveRoomListDisplayName(room, matrixCredentials?.user_id ?? null);
                                })()}
                                accessToken={taskAccessToken}
                                hsUrl={taskHsUrl}
                                matrixUserId={matrixCredentials?.user_id ?? null}
                                onOpenRoom={(roomId) => {
                                    setActiveRoomId(roomId);
                                    setActiveTab("chat");
                                    setMobileView("detail");
                                }}
                                onOpenTasksTab={() => {
                                    setActiveTab("tasks");
                                    setMobileView("list");
                                }}
                                onMobileDetail={() => setMobileView("detail")}
                                onMobileList={() => setMobileView("list")}
                            />
                        </Suspense>
                    ) : (
                        <DeferredModulePanel
                            title="Preparing tasks"
                            description="The task workspace is restoring local data before showing the latest task state."
                        />
                    )
                ) : activeTab === "settings" || activeTab === "account" ? (
                    <Suspense fallback={null}>
                        <SettingsAccountDetail
                            activeTab={activeTab}
                            settingsDetail={settingsDetail}
                            setSettingsDetail={setSettingsDetail}
                            setMobileView={setMobileView}
                            chatReceiveLanguage={chatReceiveLanguage}
                            chatReceiveLanguageSaving={chatReceiveLanguageSaving}
                            translationDefaultView={translationDefaultView}
                            setTranslationDefaultView={setTranslationDefaultView}
                            handleChatReceiveLanguageChange={handleChatReceiveLanguageChange}
                            activePluginSettingsSection={activePluginSettingsSection}
                            runtimeContext={pluginRuntimeContextValue}
                            platformState={platformState}
                            tools={tools}
                            returnToMobileList={returnToMobileList}
                        />
                    </Suspense>
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
                            notebookApiBaseUrl: effectiveNotebookApiBaseUrl,
                        }}
                    />
                )}

                {/* Placeholder for when no chat is selected (if Outlet is empty) */}
                {/* <div className="flex-1 flex items-center justify-center text-gray-400">Select a chat to start messaging</div> */}
            </main>

            {/* Create Room Modal */}
            <Suspense fallback={null}>
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
            </Suspense>
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

        </div>
    );
};
