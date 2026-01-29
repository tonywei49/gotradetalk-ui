import React, { useEffect, useState } from "react";
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
            {badgeCount && badgeCount > 0 && (
                <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center">
                    {badgeCount > 99 ? "99+" : badgeCount}
                </span>
            )}
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
    const themeMode = useThemeStore((state) => state.mode);
    const toggleMode = useThemeStore((state) => state.toggleMode);
    const matrixCredentials = useAuthStore((state) => state.matrixCredentials);
    const matrixClient = useAuthStore((state) => state.matrixClient);
    const hubAccessToken = useAuthStore((state) => state.hubSession?.access_token ?? null);
    const matrixAccessToken = useAuthStore((state) => state.matrixCredentials?.access_token ?? null);
    const matrixHsUrl = useAuthStore((state) => state.matrixCredentials?.hs_url ?? null);
    const clearSession = useAuthStore((state) => state.clearSession);
    const navigate = useNavigate();

    useEffect(() => {
        if (!matrixClient) return undefined;
        matrixClient.startClient({ initialSyncLimit: 20 });
        return () => {
            matrixClient.stopClient();
        };
    }, [matrixClient]);

    const onLogout = (): void => {
        clearSession();
        navigate("/auth");
    };

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-gray-100 font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            {/* 1. Leftmost Nav Bar (w-16, bg-gray-900) */}
            <nav className="w-16 bg-gray-900 flex flex-col items-center py-4 flex-shrink-0 z-20 dark:bg-slate-900">
                {/* App Logo Placeholder */}
                <div className="w-10 h-10 bg-[#2F5C56] rounded-xl mb-8 flex items-center justify-center text-white font-bold text-xs">
                    GT
                </div>

                {/* Nav Items */}
                <div className="flex-1 w-full flex flex-col gap-2">
                    <NavBarItem
                        icon={ChatBubbleLeftRightIcon}
                        active={activeTab === "chat"}
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
                        onClick={onLogout}
                        className="w-full h-12 flex items-center justify-center text-rose-400 hover:text-rose-300 transition-colors text-xs font-semibold"
                    >
                        Logout
                    </button>
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
                                {matrixCredentials?.user_id ?? "User"}
                            </div>
                            <div className="text-xs text-slate-500 truncate dark:text-slate-400">Account</div>
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
                    activeRoomId={activeRoomId}
                    onSelectRoom={(roomId) => setActiveRoomId(roomId)}
                    onInviteBadgeChange={setInviteBadgeCount}
                />
            </aside>

            {/* 3. Chat Area (Flex-grow, bg-[#F2F4F7]) */}
            <main className="flex-1 flex flex-col bg-[#F2F4F7] relative min-w-0 dark:bg-slate-950">
                {/* Render nested routes (ChatRoom) here */}
                <Outlet context={{ activeRoomId }} />

                {/* Placeholder for when no chat is selected (if Outlet is empty) */}
                {/* <div className="flex-1 flex items-center justify-center text-gray-400">Select a chat to start messaging</div> */}
            </main>
        </div>
    );
};
