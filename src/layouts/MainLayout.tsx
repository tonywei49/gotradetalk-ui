import React, { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import {
    ChatBubbleLeftRightIcon,
    UserGroupIcon,
    Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import { EventType } from "matrix-js-sdk";
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
import { setLanguage } from "../i18n";
import { markRoomDeprecated } from "../services/matrix";
import { DEPRECATED_DM_PREFIX } from "../constants/rooms";

// Placeholder for RoomList and ChatArea to be implemented later
// For now, we just create the layout structure
type NavBarItemProps = {
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    active?: boolean;
    onClick?: () => void;
    badgeCount?: number;
};

const NavBarItem = ({ icon: Icon, active, onClick, badgeCount }: NavBarItemProps) => (
    <div
        onClick={onClick}
        className={`
            w-full h-16 flex items-center justify-center cursor-pointer transition-colors
            ${active ? "text-[#2F5C56] bg-gray-800" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"}
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
                <div className="absolute -left-5 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#2F5C56] rounded-r-full" />
            )}
        </div>
    </div>
);

export const MainLayout: React.FC = () => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<"chat" | "contacts" | "orders" | "settings" | "account">("chat");
    const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
    const [pinnedRoomIds, setPinnedRoomIds] = useState<string[]>([]);
    const [inviteBadgeCount, setInviteBadgeCount] = useState(0);
    const [unreadBadgeCount, setUnreadBadgeCount] = useState(0);
    const [activeContact, setActiveContact] = useState<ContactSummary | null>(null);
    const [showContactMenu, setShowContactMenu] = useState(false);
    const [contactsRefreshToken, setContactsRefreshToken] = useState(0);
    const [mobileView, setMobileView] = useState<"list" | "detail">("list");
    const [settingsDetail, setSettingsDetail] = useState<"none" | "chat-language">("none");
    const [displayLanguage, setDisplayLanguage] = useState<string>("en");
    const [chatReceiveLanguage, setChatReceiveLanguage] = useState<string>("en");
    const [pendingChatReceiveLanguage, setPendingChatReceiveLanguage] = useState<string>("en");
    const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
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
    const clearSession = useAuthStore((state) => state.clearSession);
    const navigate = useNavigate();
    const [showAccountMenu, setShowAccountMenu] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);
    const accountButtonRef = useRef<HTMLButtonElement | null>(null);
    const [meProfile, setMeProfile] = useState<HubProfileSummary | null>(null);
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
    const meUpdateToken = hubAccessToken && !localeTokenExpired ? hubAccessToken : matrixAccessToken;
    const meUpdateOptions =
        hubAccessToken && !localeTokenExpired
            ? undefined
            : {
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials?.user_id ?? null,
            };
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
        const accessToken = hubAccessToken || matrixAccessToken;
        if (!accessToken) return;
        let isActive = true;
        void (async () => {
            try {
                const response = await hubGetMe({
                    accessToken,
                    hsUrl: matrixHsUrl,
                    matrixUserId: matrixCredentials?.user_id,
                });
                if (!isActive) return;
                setMeProfile(response.profile);
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
            }
        })();
        return () => {
            isActive = false;
        };
    }, [hubAccessToken, matrixAccessToken, matrixHsUrl, matrixCredentials?.user_id]);

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
        if (activeTab !== "contacts") {
            setActiveContact(null);
            setShowContactMenu(false);
        }
        setMobileView("list");
        setSettingsDetail("none");
    }, [activeTab]);

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
            setContactsRefreshToken((prev) => prev + 1);
        } catch {
            setShowContactMenu(false);
        }
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
                <div className="flex-1 w-full flex items-center justify-center gap-2 lg:flex-col">
                    <NavBarItem
                        icon={ChatBubbleLeftRightIcon}
                        active={activeTab === "chat"}
                        badgeCount={unreadBadgeCount}
                        onClick={() => setActiveTab("chat")}
                    />
                    <NavBarItem
                        icon={UserGroupIcon}
                        active={activeTab === "contacts"}
                        badgeCount={inviteBadgeCount}
                        onClick={() => setActiveTab("contacts")}
                    />
                </div>

                {/* Bottom Actions */}
                <div className="w-full flex items-center justify-end gap-2 lg:flex-col lg:mb-4">
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
                        />
                    </>
                )}
            </aside>

            {/* 3. Chat Area (Flex-grow, bg-[#F2F4F7]) */}
            <main
                className={`flex-1 min-h-0 flex flex-col bg-[#F2F4F7] relative min-w-0 dark:bg-slate-950 ${mobileView === "list" ? "hidden lg:flex" : "flex"
                    }`}
            >
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
                                                    onClick={() => void onRemoveActiveContact()}
                                                    className="w-full px-3 py-2 text-left text-rose-500 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-slate-800"
                                                >
                                                    {t("layout.removeContact")}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

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
                accessToken={hubAccessToken || matrixAccessToken}
                hsUrl={matrixHsUrl}
            />
        </div>
    );
};
