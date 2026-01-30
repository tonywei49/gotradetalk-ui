import React, { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import {
    ChatBubbleLeftRightIcon,
    UserGroupIcon,
    ClipboardDocumentListIcon,
    Cog6ToothIcon,
    MoonIcon,
    SunIcon,
} from "@heroicons/react/24/outline";
import { useThemeStore } from "../stores/ThemeStore";
import { useAuthStore } from "../stores/AuthStore";
import { RoomList } from "../features/rooms";
import type { ContactSummary } from "../features/rooms/RoomList";
import { hubGetMe } from "../api/hub";
import type { HubProfileSummary } from "../api/types";
import { removeContact } from "../api/contacts";
import { getDirectRoomId, getOrCreateDirectRoom, hideDirectRoom } from "../matrix/direct";
import { translationLanguageOptions } from "../constants/translationLanguages";

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
    const [activeTab, setActiveTab] = useState<"chat" | "contacts" | "orders" | "settings">("chat");
    const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
    const [inviteBadgeCount, setInviteBadgeCount] = useState(0);
    const [unreadBadgeCount, setUnreadBadgeCount] = useState(0);
    const [activeContact, setActiveContact] = useState<ContactSummary | null>(null);
    const [showContactMenu, setShowContactMenu] = useState(false);
    const [contactsRefreshToken, setContactsRefreshToken] = useState(0);
    const contactMenuRef = useRef<HTMLDivElement | null>(null);
    const contactMenuButtonRef = useRef<HTMLButtonElement | null>(null);
    const themeMode = useThemeStore((state) => state.mode);
    const toggleMode = useThemeStore((state) => state.toggleMode);
    const matrixCredentials = useAuthStore((state) => state.matrixCredentials);
    const matrixClient = useAuthStore((state) => state.matrixClient);
    const hubAccessToken = useAuthStore((state) => state.hubSession?.access_token ?? null);
    const hubSessionExpiresAt = useAuthStore((state) => state.hubSession?.expires_at ?? null);
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
    const accountSubtitle = accountSubtitleParts.length ? accountSubtitleParts.join(" · ") : "Account";

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

    const onLogout = (): void => {
        clearSession();
        navigate("/auth");
    };

    const getLocalPart = (value: string | null | undefined): string => {
        if (!value) return "";
        const trimmed = value.startsWith("@") ? value.slice(1) : value;
        return trimmed.split(":")[0] || "";
    };

    const getContactLabel = (contact: ContactSummary | null): string => {
        if (!contact) return "Contact";
        const localpart = contact.userLocalId || getLocalPart(contact.matrixUserId);
        if (localpart && contact.displayName && contact.displayName !== localpart) {
            return `${localpart} (${contact.displayName})`;
        }
        return localpart || contact.displayName || "Contact";
    };

    const getGenderLabel = (value: string | null): string => {
        if (!value) return "—";
        if (value === "male") return "Male";
        if (value === "female") return "Female";
        return value;
    };

    const getLanguageLabel = (contact: ContactSummary | null): string => {
        if (!contact) return "—";
        const locale = contact.translationLocale || contact.locale;
        if (!locale) return "—";
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
    };

    const onRemoveActiveContact = async (): Promise<void> => {
        if (!actionToken || !activeContact) return;
        try {
            await removeContact(actionToken, activeContact.id, actionHsUrl);
            const matrixUserId =
                activeContact.matrixUserId ||
                (activeContact.userLocalId && matrixHost ? `@${activeContact.userLocalId}:${matrixHost}` : null);
            if (matrixClient && matrixUserId) {
                const roomId = getDirectRoomId(matrixClient, matrixUserId);
                if (roomId) {
                    await hideDirectRoom(matrixClient, matrixUserId, roomId);
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
        <div className="flex h-screen w-screen overflow-hidden bg-gray-100 font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            {/* 1. Leftmost Nav Bar (w-16, bg-gray-900) */}
            <nav className="w-16 bg-gray-900 flex flex-col items-center py-4 flex-shrink-0 z-20 dark:bg-slate-900">
                {/* App Logo Placeholder */}
                <div className="relative mb-8">
                    <button
                        ref={accountButtonRef}
                        type="button"
                        onClick={() => setShowAccountMenu((prev) => !prev)}
                        className="w-10 h-10 bg-[#2F5C56] rounded-xl flex items-center justify-center text-white font-bold text-sm"
                        aria-label="Account menu"
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
                                    setActiveTab("settings");
                                    setShowAccountMenu(false);
                                }}
                                className="w-full px-3 py-2 text-left text-slate-700 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                賬號設定
                            </button>
                            <button
                                type="button"
                                onClick={onLogout}
                                className="w-full px-3 py-2 text-left text-rose-500 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-slate-800"
                            >
                                Logout
                            </button>
                        </div>
                    )}
                </div>

                {/* Nav Items */}
                <div className="flex-1 w-full flex flex-col gap-2">
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
                    <NavBarItem
                        icon={ClipboardDocumentListIcon}
                        active={activeTab === "orders"}
                        onClick={() => setActiveTab("orders")}
                    />
                </div>

                {/* Bottom Actions */}
                <div className="w-full flex flex-col gap-2 mb-4">
                    <NavBarItem
                        icon={Cog6ToothIcon}
                        active={activeTab === "settings"}
                        onClick={() => setActiveTab("settings")}
                    />
                    <button
                        type="button"
                        onClick={toggleMode}
                        className="w-full h-12 flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors"
                        aria-label="Toggle theme"
                    >
                        {themeMode === "dark" ? (
                            <SunIcon className="w-6 h-6" />
                        ) : (
                            <MoonIcon className="w-6 h-6" />
                        )}
                    </button>
                    {/* Avatar Placeholder */}
                    <div className="w-full flex justify-center mt-4">
                        <div className="w-10 h-10 rounded-full bg-gray-700 border-2 border-gray-600 overflow-hidden">
                            {/* <img src="..." /> */}
                        </div>
                    </div>
                </div>
            </nav>

            {/* 2. List Panel (w-80, bg-white) */}
            <aside className="w-80 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 z-10 shadow-sm dark:bg-slate-900 dark:border-slate-800">
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
                            placeholder="Search"
                            className="bg-transparent border-none outline-none text-sm w-full text-slate-700 placeholder-gray-400 dark:text-slate-200 dark:placeholder-slate-500"
                        />
                    </div>
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
                    onSelectRoom={(roomId) => setActiveRoomId(roomId)}
                    onInviteBadgeChange={setInviteBadgeCount}
                    onUnreadBadgeChange={setUnreadBadgeCount}
                    view={activeTab === "contacts" ? "contacts" : "chat"}
                    onSelectContact={(contact) => setActiveContact(contact)}
                    activeContactId={activeContact?.id ?? null}
                    contactsRefreshToken={contactsRefreshToken}
                />
            </aside>

            {/* 3. Chat Area (Flex-grow, bg-[#F2F4F7]) */}
            <main className="flex-1 flex flex-col bg-[#F2F4F7] relative min-w-0 dark:bg-slate-950">
                {/* Render nested routes (ChatRoom) here */}
                {activeTab === "contacts" ? (
                    <div className="flex-1 flex flex-col bg-white dark:bg-slate-900">
                        {activeContact ? (
                            <div className="flex-1 flex flex-col">
                                <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100 dark:border-slate-800">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-semibold dark:bg-emerald-900/40 dark:text-emerald-200">
                                            {getContactLabel(activeContact).charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">
                                                {getContactLabel(activeContact)}
                                            </div>
                                            <div className="text-sm text-slate-500 dark:text-slate-400">
                                                {activeContact.companyName || "—"}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="relative">
                                        <button
                                            ref={contactMenuButtonRef}
                                            type="button"
                                            onClick={() => setShowContactMenu((prev) => !prev)}
                                            className="h-10 w-10 rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                            aria-label="Contact actions"
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
                                                    刪除好友
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex-1 px-8 py-6">
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                ID
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {activeContact.userLocalId || getLocalPart(activeContact.matrixUserId) || "—"}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                Name
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {activeContact.displayName || "—"}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                Gender
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {getGenderLabel(activeContact.gender)}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                Country
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {activeContact.country || "—"}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950">
                                            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                Language
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                {getLanguageLabel(activeContact)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="px-8 pb-8">
                                    <button
                                        type="button"
                                        onClick={() => void onStartContactChat()}
                                        className="inline-flex items-center justify-center rounded-xl bg-[#2F5C56] px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#244a45] dark:bg-emerald-500 dark:hover:bg-emerald-400"
                                    >
                                        Chat
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                Select a contact to view details.
                            </div>
                        )}
                    </div>
                ) : (
                    <Outlet context={{ activeRoomId }} />
                )}

                {/* Placeholder for when no chat is selected (if Outlet is empty) */}
                {/* <div className="flex-1 flex items-center justify-center text-gray-400">Select a chat to start messaging</div> */}
            </main>
        </div>
    );
};
