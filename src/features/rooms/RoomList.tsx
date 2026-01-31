import { useEffect, useMemo, useState } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { ClientEvent, EventType, RoomEvent } from "matrix-js-sdk";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";

import { searchDirectoryAll, searchStaffDirectoryCustomers, searchStaffDirectoryEmployees } from "../../api/directory";
import {
    acceptContact,
    listContactRequests,
    listContacts,
    listOutgoingContactRequests,
    rejectContact,
    requestContact,
} from "../../api/contacts";
import { getDirectRoomId, getOrCreateDirectRoom, hideDirectRoom, setDirectRoom, createDirectRoomWithMessage, joinDirectRoom } from "../../matrix/direct";
import { playNotificationSound } from "../../utils/notificationSound";

type DirectRoomEntry = {
    userId: string;
    roomId: string;
    room: Room;
    displayName: string;
    lastMessage: string;
    lastActive: number;
    unreadCount: number;
};

export type ContactSummary = {
    id: string;
    initiatedByMe: boolean;
    userType: string | null;
    displayName: string | null;
    userLocalId: string | null;
    companyName: string | null;
    country: string | null;
    matrixUserId: string | null;
    gender: string | null;
    locale: string | null;
    translationLocale: string | null;
};

type RoomListProps = {
    client: MatrixClient | null;
    hubAccessToken: string | null;
    matrixAccessToken: string | null;
    matrixHsUrl: string | null;
    userType: "client" | "staff" | null;
    hubSessionExpiresAt: number | null;
    activeRoomId: string | null;
    onSelectRoom: (roomId: string) => void;
    onInviteBadgeChange?: (count: number) => void;
    onUnreadBadgeChange?: (count: number) => void;
    view?: "chat" | "contacts";
    onSelectContact?: (contact: ContactSummary | null) => void;
    activeContactId?: string | null;
    contactsRefreshToken?: number;
};

const EMPTY_STATE: DirectRoomEntry[] = [];
const STAFF_CUSTOMER_DOMAIN = "matrix.gotradetalk.com";

function normalizeMatrixLocalpart(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    return withoutAt.split(":")[0].trim();
}

function normalizeMatrixDomain(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const withoutScheme = trimmed.replace(/^https?:\/\//i, "");
    return withoutScheme.split("/")[0].trim();
}

function buildMatrixUserId(localpart: string, domain: string): string | null {
    if (!localpart || !domain) return null;
    return `@${localpart}:${domain}`;
}

function getMatrixHost(hsUrl: string | null): string | null {
    if (!hsUrl) return null;
    try {
        return new URL(hsUrl).host;
    } catch {
        return null;
    }
}

function getLastMessagePreview(room: Room): string {
    const events = room.getLiveTimeline().getEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.getType() !== EventType.RoomMessage) continue;
        const content = event.getContent() as { body?: string } | undefined;
        if (content?.body) {
            return content.body;
        }
    }
    return "";
}

function buildDirectRooms(client: MatrixClient): DirectRoomEntry[] {
    const accountData = client.getAccountData(EventType.Direct);
    const content = (accountData?.getContent() ?? {}) as Record<string, string[]>;
    const byUser = new Map<string, DirectRoomEntry>();
    const visibleRoomIds = new Set(client.getVisibleRooms().map((room) => room.roomId));

    Object.entries(content).forEach(([userId, roomIds]) => {
        roomIds.forEach((roomId) => {
            if (!visibleRoomIds.has(roomId)) return;
            const room = client.getRoom(roomId);
            if (!room) return;
            const lastActive = room.getLastActiveTimestamp();
            const unreadCount = room.getUnreadNotificationCount() ?? 0;
            const entry: DirectRoomEntry = {
                userId,
                roomId,
                room,
                displayName: room.getMember(userId)?.name ?? userId,
                lastMessage: getLastMessagePreview(room),
                lastActive,
                unreadCount,
            };
            const existing = byUser.get(userId);
            if (!existing || entry.lastActive > existing.lastActive) {
                byUser.set(userId, entry);
            }
        });
    });

    return Array.from(byUser.values()).sort((a, b) => b.lastActive - a.lastActive);
}

export function RoomList({
    client,
    hubAccessToken,
    matrixAccessToken,
    matrixHsUrl,
    userType,
    hubSessionExpiresAt,
    activeRoomId,
    onSelectRoom,
    onInviteBadgeChange,
    onUnreadBadgeChange,
    view = "chat",
    onSelectContact,
    activeContactId,
    contactsRefreshToken,
}: RoomListProps) {
    const { t } = useTranslation();
    const [rooms, setRooms] = useState<DirectRoomEntry[]>(EMPTY_STATE);
    const [query, setQuery] = useState("");
    const [staffSearchMode, setStaffSearchMode] = useState<"customer" | "staff">("customer");
    const [staffCustomerId, setStaffCustomerId] = useState("");
    const [staffCompanyDomain, setStaffCompanyDomain] = useState("");
    const [staffPersonId, setStaffPersonId] = useState("");
    const [searchBusy, setSearchBusy] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResults, setSearchResults] = useState<
        {
            id: string;
            displayName: string | null;
            userLocalId: string | null;
            companyName: string | null;
            title: string | null;
            country: string | null;
            matrixUserId: string | null;
        }[]
    >([]);
    const [showSearchModal, setShowSearchModal] = useState(false);
    const [contacts, setContacts] = useState<ContactSummary[]>([]);
    const [incomingRequests, setIncomingRequests] = useState<
        {
            id: string;
            requesterId: string;
            requesterUserType: string | null;
            displayName: string | null;
            userLocalId: string | null;
            companyName: string | null;
            country: string | null;
            matrixUserId: string | null;
            matrixRoomId: string | null;
            initialMessage: string | null;
        }[]
    >([]);
    const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
    const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
    const [acceptedMatrixUserIds, setAcceptedMatrixUserIds] = useState<Set<string>>(new Set());
    const [contactSort, setContactSort] = useState<"company" | "name">("company");
    // 選中的搜索結果和初始消息（用於發送好友請求）
    const [selectedSearchItem, setSelectedSearchItem] = useState<{
        id: string;
        matrixUserId: string | null;
        displayName: string | null;
    } | null>(null);
    const [initialMessage, setInitialMessage] = useState("");

    const refresh = useMemo(() => {
        if (!client) return null;
        return () => {
            setRooms(buildDirectRooms(client));
        };
    }, [client]);

    useEffect(() => {
        if (!client || !refresh) {
            setRooms(EMPTY_STATE);
            return undefined;
        }

        refresh();

        const onTimeline = (
            event: MatrixEvent,
            room: Room | undefined,
            toStartOfTimeline: boolean | undefined,
            removed: boolean,
        ): void => {
            if (!room || removed) return;
            if (toStartOfTimeline) return;
            refresh();

            // 在非活動房間，或頁面隱藏時收到新消息播放提示音
            if (event.getType() === EventType.RoomMessage) {
                const myUserId = client.getUserId();
                const isFromMe = event.getSender() === myUserId;
                const isBackground = typeof document !== "undefined" && document.hidden;
                if (!isFromMe && (room.roomId !== activeRoomId || isBackground)) {
                    playNotificationSound();
                }
            }
        };

        const onAccountData = (event: MatrixEvent): void => {
            if (event.getType() === EventType.Direct) {
                refresh();
            }
        };

        // 監聽已讀回執事件，更新未讀計數
        const onReceipt = (): void => {
            refresh();
        };

        client.on(RoomEvent.Timeline, onTimeline);
        client.on(ClientEvent.AccountData, onAccountData);
        client.on(RoomEvent.Receipt, onReceipt);

        return () => {
            client.off(RoomEvent.Timeline, onTimeline);
            client.off(ClientEvent.AccountData, onAccountData);
            client.off(RoomEvent.Receipt, onReceipt);
        };
    }, [client, refresh, activeRoomId]);

    useEffect(() => {
        if (!rooms.length) return;
        if (!activeRoomId || !rooms.some((room) => room.roomId === activeRoomId)) {
            onSelectRoom(rooms[0].roomId);
        }
    }, [rooms, activeRoomId, onSelectRoom]);

    // 計算總未讀數並通知父組件
    useEffect(() => {
        const totalUnread = rooms.reduce((sum, room) => sum + room.unreadCount, 0);
        onUnreadBadgeChange?.(totalUnread);
    }, [rooms, onUnreadBadgeChange]);

    const hubTokenExpired = hubSessionExpiresAt ? hubSessionExpiresAt * 1000 <= Date.now() : false;
    const isStaffSearch = userType === "staff";
    const useHubToken = !isStaffSearch && Boolean(hubAccessToken) && !hubTokenExpired;
    const searchToken = useHubToken ? hubAccessToken : matrixAccessToken;
    const searchHsUrl = useHubToken ? null : matrixHsUrl;
    const matrixHost = getMatrixHost(matrixHsUrl);

    useEffect(() => {
        if (isStaffSearch) return;
        if (!query.trim()) {
            setSearchResults([]);
            setSearchError(null);
            return;
        }
        if (!searchToken) {
            setSearchError(t("roomList.errors.searchRequiresToken"));
            setSearchResults([]);
            return;
        }
        const handler = window.setTimeout(() => {
            void (async () => {
                setSearchBusy(true);
                setSearchError(null);
                try {
                    const results = await searchDirectoryAll(query.trim(), searchToken, searchHsUrl);
                    setSearchResults(
                        results.map((item) => ({
                            id: item.profile_id,
                            displayName: item.display_name,
                            userLocalId: item.user_local_id,
                            companyName: item.company_name,
                            title: null,
                            country: item.country,
                            matrixUserId: item.matrix_user_id ?? null,
                        })),
                    );
                } catch (error) {
                    setSearchError(error instanceof Error ? error.message : t("roomList.errors.searchFailed"));
                    setSearchResults([]);
                } finally {
                    setSearchBusy(false);
                }
            })();
        }, 350);

        return () => window.clearTimeout(handler);
    }, [isStaffSearch, query, searchToken, searchHsUrl]);

    useEffect(() => {
        if (!isStaffSearch) return;
        if (!searchToken) {
            setSearchError(t("roomList.errors.searchRequiresToken"));
            setSearchResults([]);
            return;
        }
        if (!searchHsUrl) {
            setSearchError(t("roomList.errors.missingHomeserver"));
            setSearchResults([]);
            return;
        }

        const handler = window.setTimeout(() => {
            void (async () => {
                setSearchBusy(true);
                setSearchError(null);
                try {
                    if (staffSearchMode === "customer") {
                        const localpart = normalizeMatrixLocalpart(staffCustomerId);
                        if (!localpart) {
                            setSearchResults([]);
                            setSearchError(null);
                            return;
                        }
                        const matrixUserId = buildMatrixUserId(localpart, STAFF_CUSTOMER_DOMAIN);
                        if (!matrixUserId) {
                            setSearchResults([]);
                            setSearchError(t("roomList.errors.invalidUserId"));
                            return;
                        }
                        const results = await searchStaffDirectoryCustomers(matrixUserId, searchHsUrl, searchToken);
                        const filtered = results.filter((item) => item.matrix_user_id === matrixUserId);
                        setSearchResults(
                            filtered.map((item) => ({
                                id: item.customer_user_id,
                                displayName: item.display_name,
                                userLocalId: null,
                                companyName: null,
                                title: null,
                                country: null,
                                matrixUserId: item.matrix_user_id ?? null,
                            })),
                        );
                        return;
                    }

                    const normalizedDomain = normalizeMatrixDomain(staffCompanyDomain);
                    const domain = normalizedDomain
                        ? normalizedDomain.startsWith("matrix.")
                            ? normalizedDomain
                            : `matrix.${normalizedDomain}`
                        : "";
                    const localpart = normalizeMatrixLocalpart(staffPersonId);
                    if (!localpart || !domain) {
                        setSearchResults([]);
                        setSearchError(null);
                        return;
                    }
                    const results = await searchStaffDirectoryEmployees(domain, localpart, searchHsUrl, searchToken);
                    const matrixUserId = buildMatrixUserId(localpart, domain);
                    setSearchResults(
                        results.map((item) => ({
                            id: item.person_id,
                            displayName: item.display_name,
                            userLocalId: item.username,
                            companyName: item.company_name,
                            title: item.title ?? null,
                            country: null,
                            matrixUserId: item.matrix_user_id ?? matrixUserId,
                        })),
                    );
                } catch (error) {
                    setSearchError(error instanceof Error ? error.message : t("roomList.errors.searchFailed"));
                    setSearchResults([]);
                } finally {
                    setSearchBusy(false);
                }
            })();
        }, 350);

        return () => window.clearTimeout(handler);
    }, [
        isStaffSearch,
        searchToken,
        searchHsUrl,
        staffSearchMode,
        staffCustomerId,
        staffCompanyDomain,
        staffPersonId,
    ]);

    const refreshContacts = async (): Promise<void> => {
        if (!searchToken) return;
        try {
            const [contactItems, requestItems, outgoingItems] = await Promise.all([
                listContacts(searchToken, searchHsUrl),
                listContactRequests(searchToken, searchHsUrl),
                listOutgoingContactRequests(searchToken, searchHsUrl),
            ]);
            setContacts(
                contactItems.map((item) => ({
                    id: item.user_id,
                    initiatedByMe: item.initiated_by_me,
                    userType: item.user_type,
                    displayName: item.display_name,
                    userLocalId: item.user_local_id,
                    companyName: item.company_name,
                    country: item.country,
                    matrixUserId: item.matrix_user_id,
                    gender: item.gender,
                    locale: item.locale,
                    translationLocale: item.translation_locale,
                })),
            );
            setAcceptedIds(new Set(contactItems.map((item) => item.user_id)));
            setAcceptedMatrixUserIds(
                new Set(contactItems.map((item) => item.matrix_user_id).filter((value): value is string => Boolean(value))),
            );
            setIncomingRequests(
                requestItems.map((item) => ({
                    id: item.request_id,
                    requesterId: item.requester_id,
                    requesterUserType: item.user_type,
                    displayName: item.display_name,
                    userLocalId: item.user_local_id,
                    companyName: item.company_name,
                    country: item.country,
                    matrixUserId: item.matrix_user_id,
                    matrixRoomId: item.matrix_room_id,
                    initialMessage: item.initial_message,
                })),
            );
            setRequestedIds(new Set(outgoingItems.map((item) => item.target_id)));
        } catch {
            // ignore list failures
        }
    };

    useEffect(() => {
        if (!searchToken) return;
        void refreshContacts();
        const timer = window.setInterval(() => {
            void refreshContacts();
        }, 6000);
        return () => window.clearInterval(timer);
    }, [searchToken, searchHsUrl, contactsRefreshToken]);

    useEffect(() => {
        if (!onInviteBadgeChange) return;
        onInviteBadgeChange(incomingRequests.length);
    }, [incomingRequests.length, onInviteBadgeChange]);

    useEffect(() => {
        if (!showSearchModal || !searchToken) return undefined;
        let alive = true;
        const refreshRequests = async (): Promise<void> => {
            try {
                const [requestItems, outgoingItems] = await Promise.all([
                    listContactRequests(searchToken, searchHsUrl),
                    listOutgoingContactRequests(searchToken, searchHsUrl),
                ]);
                if (!alive) return;
                setIncomingRequests(
                    requestItems.map((item) => ({
                        id: item.request_id,
                        requesterId: item.requester_id,
                        requesterUserType: item.user_type,
                        displayName: item.display_name,
                        userLocalId: item.user_local_id,
                        companyName: item.company_name,
                        country: item.country,
                        matrixUserId: item.matrix_user_id,
                        matrixRoomId: item.matrix_room_id,
                        initialMessage: item.initial_message,
                    })),
                );
                setRequestedIds(new Set(outgoingItems.map((item) => item.target_id)));
            } catch {
                // ignore refresh failures
            }
        };
        void refreshRequests();
        const timer = window.setInterval(() => {
            void refreshRequests();
        }, 6000);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
    }, [showSearchModal, searchToken, searchHsUrl]);

    const onRequestContact = async (targetId: string, targetMatrixUserId: string | null, initialMessage: string): Promise<void> => {
        if (!searchToken || !client || !targetMatrixUserId) return;
        if (!initialMessage.trim()) {
            setSearchError(t("roomList.errors.greetingRequired"));
            return;
        }
        try {
            // 1. 創建房間並發送初始消息
            const roomId = await createDirectRoomWithMessage(client, targetMatrixUserId, initialMessage.trim());

            // 2. 將房間 ID 傳給 Hub API
            const result = await requestContact(searchToken, targetId, initialMessage.trim(), roomId, searchHsUrl);
            if (result.status === "pending") {
                setRequestedIds((prev) => new Set(prev).add(targetId));
            }
            await refreshContacts();

            // 3. 選擇新創建的房間
            onSelectRoom(roomId);
            setShowSearchModal(false);
            setQuery("");
            setStaffCustomerId("");
            setStaffCompanyDomain("");
            setStaffPersonId("");
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : t("roomList.errors.requestFailed"));
        }
    };

    const getAccountIdLabel = (item: { matrixUserId: string | null; userLocalId: string | null }): string => {
        if (item.matrixUserId) {
            const withoutAt = item.matrixUserId.startsWith("@") ? item.matrixUserId.slice(1) : item.matrixUserId;
            return withoutAt.split(":")[0] || "-";
        }
        return item.userLocalId || "-";
    };

    const getMetaLabel = (item: { companyName: string | null; title: string | null; country: string | null }): string =>
        `${item.companyName || "-"} · ${item.title || "-"} · ${item.country || "-"}`;

    const joinInviteFromUser = async (inviterUserId: string): Promise<string | null> => {
        if (!client) return null;
        const myUserId = client.getUserId();
        if (!myUserId) return null;
        const inviteRoom = client.getRooms().find((room) => {
            if (room.getMyMembership() !== "invite") return false;
            const inviteEvent = room.currentState.getStateEvents(EventType.RoomMember, myUserId);
            return inviteEvent?.getSender() === inviterUserId;
        });
        if (!inviteRoom) return null;
        await client.joinRoom(inviteRoom.roomId);
        await setDirectRoom(client, inviterUserId, inviteRoom.roomId);
        return inviteRoom.roomId;
    };

    const waitForInviteFromUser = async (inviterUserId: string): Promise<string | null> => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const roomId = await joinInviteFromUser(inviterUserId);
            if (roomId) return roomId;
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
        return null;
    };

    const sortedContacts = useMemo(() => {
        const copy = [...contacts];
        const compareText = (a: string | null, b: string | null): number => {
            const left = (a || "").toLowerCase();
            const right = (b || "").toLowerCase();
            return left.localeCompare(right);
        };
        return copy.sort((a, b) => {
            if (contactSort === "company") {
                const companyDiff = compareText(a.companyName, b.companyName);
                if (companyDiff !== 0) return companyDiff;
            }
            return compareText(a.displayName || a.userLocalId, b.displayName || b.userLocalId);
        });
    }, [contacts, contactSort]);

    const onAcceptRequest = async (
        requesterId: string,
        matrixUserId: string | null,
        requesterUserType: string | null,
        matrixRoomId: string | null,
    ): Promise<void> => {
        if (!searchToken) return;
        try {
            // 調用 Hub API 接受請求並獲取房間 ID
            const result = await acceptContact(searchToken, requesterId, searchHsUrl);
            setIncomingRequests((prev) => prev.filter((item) => item.requesterId !== requesterId));
            await refreshContacts();

            if (client && matrixUserId) {
                // 優先使用請求中保存的房間 ID
                const roomIdToJoin = matrixRoomId || result.matrix_room_id;

                if (roomIdToJoin) {
                    // 加入請求方創建的房間
                    await joinDirectRoom(client, roomIdToJoin, matrixUserId);
                    onSelectRoom(roomIdToJoin);
                    setShowSearchModal(false);
                } else if (userType === "staff" && requesterUserType === "client") {
                    // 備用邏輯：Staff 對 Client 的情況
                    const roomId = await getOrCreateDirectRoom(client, matrixUserId);
                    onSelectRoom(roomId);
                    setShowSearchModal(false);
                } else {
                    // 備用邏輯：等待邀請
                    const joinedRoomId = await waitForInviteFromUser(matrixUserId);
                    if (joinedRoomId) {
                        onSelectRoom(joinedRoomId);
                        setShowSearchModal(false);
                    }
                }
            }
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : t("roomList.errors.acceptFailed"));
        }
    };

    const onRejectRequest = async (requesterId: string): Promise<void> => {
        if (!searchToken) return;
        try {
            await rejectContact(searchToken, requesterId, searchHsUrl);
            setIncomingRequests((prev) => prev.filter((item) => item.requesterId !== requesterId));
            await refreshContacts();
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : t("roomList.errors.rejectFailed"));
        }
    };

    const onHideRoom = async (entry: DirectRoomEntry): Promise<void> => {
        if (!client) return;
        try {
            await hideDirectRoom(client, entry.userId, entry.roomId);
            refresh?.();
        } catch {
            // ignore hide failures
        }
    };

    const resolveContactMatrixUserId = (contact: {
        matrixUserId: string | null;
        userLocalId: string | null;
    }): string | null => {
        if (contact.matrixUserId) return contact.matrixUserId;
        if (contact.userLocalId && matrixHost) {
            return `@${contact.userLocalId}:${matrixHost}`;
        }
        return null;
    };

    const shouldCreateRoomForContact = (contact: {
        initiatedByMe: boolean;
        userType: string | null;
        matrixUserId: string | null;
        userLocalId: string | null;
    }): boolean => {
        const contactMatrixUserId = resolveContactMatrixUserId(contact);
        if (!contactMatrixUserId) return false;
        if (userType === "staff") {
            if (contact.userType === "client") return true;
            if (contact.userType === "staff") return contact.initiatedByMe;
            return contact.initiatedByMe;
        }
        if (userType === "client") {
            if (contact.userType === "client") return contact.initiatedByMe;
            if (!contact.userType) {
                const domain = contactMatrixUserId.split(":")[1] || "";
                return contact.initiatedByMe && Boolean(matrixHost) && domain === matrixHost;
            }
            return false;
        }
        return false;
    };

    useEffect(() => {
        if (!client) return;
        void (async (): Promise<void> => {
            for (const contact of contacts) {
                const contactMatrixUserId = resolveContactMatrixUserId(contact);
                if (!contactMatrixUserId) continue;
                if (!shouldCreateRoomForContact(contact)) continue;
                const existing = getDirectRoomId(client, contactMatrixUserId);
                if (!existing) {
                    await getOrCreateDirectRoom(client, contactMatrixUserId);
                }
            }
        })();
    }, [client, contacts, userType]);

    const visibleRooms = acceptedMatrixUserIds.size
        ? rooms.filter((entry) => acceptedMatrixUserIds.has(entry.userId))
        : rooms;

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {view === "contacts" ? t("roomList.sections.contacts") : t("roomList.sections.directMessages")}
                </span>
                {view === "contacts" ? (
                    <button
                        type="button"
                        onClick={() => setShowSearchModal(true)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
                        aria-label={t("roomList.actions.addContact")}
                    >
                        <PlusIcon className="h-5 w-5" />
                    </button>
                ) : null}
            </div>
            {view === "chat" ? (
                visibleRooms.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">{t("roomList.empty.directChats")}</div>
                ) : (
                    visibleRooms.map((entry) => (
                        <div
                            key={entry.roomId}
                            className={`group w-full px-4 py-2 flex gap-3 items-center hover:bg-gray-50 dark:hover:bg-slate-800 ${entry.roomId === activeRoomId ? "bg-[#F0F7F6] dark:bg-slate-800" : ""
                                }`}
                        >
                            <button
                                type="button"
                                onClick={() => onSelectRoom(entry.roomId)}
                                className="flex-1 min-w-0 flex items-center gap-3 text-left"
                            >
                                <div className="relative w-10 h-10 flex-shrink-0">
                                    <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-slate-700" />
                                    {entry.unreadCount > 0 && (
                                        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
                                            {entry.unreadCount > 99 ? "99+" : entry.unreadCount}
                                        </span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <div className="flex justify-between items-baseline">
                                        <span className="font-semibold text-[13px] text-slate-800 truncate dark:text-slate-100">
                                            {entry.displayName}
                                        </span>
                                        <span className="text-[10px] text-gray-400 dark:text-slate-500">
                                            {entry.lastActive > 0 ? new Date(entry.lastActive).toLocaleTimeString() : ""}
                                        </span>
                                    </div>
                                    <p className="text-[12px] text-gray-500 truncate dark:text-slate-400">
                                        {entry.lastMessage || " "}
                                    </p>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => void onHideRoom(entry)}
                                className="text-xs text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                {t("roomList.actions.hide")}
                            </button>
                        </div>
                    ))
                )
            ) : (
                <div className="px-4 py-4">
                    {incomingRequests.length > 0 && (
                        <div className="mb-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-2">
                                {t("roomList.sections.requests")}
                            </div>
                            <div className="space-y-2">
                                {incomingRequests.map((item) => (
                                    <div
                                        key={item.id}
                                        className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 dark:border-slate-800"
                                    >
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                                {getAccountIdLabel({
                                                    matrixUserId: item.matrixUserId,
                                                    userLocalId: item.userLocalId,
                                                })}
                                            </div>
                                            <div className="text-xs text-slate-500 truncate dark:text-slate-400">
                                                {getMetaLabel({
                                                    companyName: item.companyName,
                                                    title: null,
                                                    country: item.country,
                                                })}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void onAcceptRequest(
                                                        item.requesterId,
                                                        item.matrixUserId,
                                                        item.requesterUserType,
                                                        item.matrixRoomId,
                                                    )
                                                }
                                                className="text-xs text-emerald-500 hover:text-emerald-400"
                                            >{t("roomList.actions.accept")}</button>
                                            <button
                                                type="button"
                                                onClick={() => void onRejectRequest(item.requesterId)}
                                                className="text-xs text-rose-400 hover:text-rose-300"
                                            >{t("roomList.actions.reject")}</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {contacts.length === 0 ? (
                        <div className="text-sm text-slate-500 dark:text-slate-400">{t("roomList.empty.contacts")}</div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setContactSort("company")}
                                    className={`text-xs px-2 py-1 rounded-full border ${contactSort === "company"
                                        ? "border-emerald-400 text-emerald-600"
                                        : "border-gray-200 text-slate-500"
                                        }`}
                                >{t("roomList.sorting.byCompany")}</button>
                                <button
                                    type="button"
                                    onClick={() => setContactSort("name")}
                                    className={`text-xs px-2 py-1 rounded-full border ${contactSort === "name"
                                        ? "border-emerald-400 text-emerald-600"
                                        : "border-gray-200 text-slate-500"
                                        }`}
                                >{t("roomList.sorting.byName")}</button>
                            </div>
                            {sortedContacts.map((contact) => (
                                <button
                                    key={contact.id}
                                    type="button"
                                    onClick={() => {
                                        onSelectContact?.(contact);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800 ${activeContactId === contact.id
                                        ? "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:ring-emerald-700"
                                        : ""
                                        }`}
                                >
                                    <div className="min-w-0 text-left">
                                        <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                            {getAccountIdLabel({
                                                matrixUserId: contact.matrixUserId,
                                                userLocalId: contact.userLocalId,
                                            })}
                                        </div>
                                        <div className="text-xs text-slate-500 truncate dark:text-slate-400">
                                            {getMetaLabel({
                                                companyName: contact.companyName,
                                                title: null,
                                                country: contact.country,
                                            })}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {showSearchModal && (
                <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t("roomList.search.startChat")}</h3>
                                {isStaffSearch && (
                                    <div className="flex items-center rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
                                        <button
                                            type="button"
                                            onClick={() => setStaffSearchMode("customer")}
                                            className={`px-3 py-1 text-xs font-semibold rounded-full ${staffSearchMode === "customer"
                                                ? "bg-emerald-500 text-white"
                                                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                                }`}
                                        >{t("roomList.search.customer")}</button>
                                        <button
                                            type="button"
                                            onClick={() => setStaffSearchMode("staff")}
                                            className={`px-3 py-1 text-xs font-semibold rounded-full ${staffSearchMode === "staff"
                                                ? "bg-emerald-500 text-white"
                                                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                                }`}
                                        >{t("roomList.search.companyStaff")}</button>
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowSearchModal(false);
                                    setQuery("");
                                    setStaffCustomerId("");
                                    setStaffCompanyDomain("");
                                    setStaffPersonId("");
                                }}
                                className="rounded-full p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                                aria-label={t("common.close")}
                            >
                                <XMarkIcon className="h-5 w-5" />
                            </button>
                        </div>
                        {isStaffSearch ? (
                            staffSearchMode === "customer" ? (
                                <input
                                    type="text"
                                    value={staffCustomerId}
                                    onChange={(event) => setStaffCustomerId(event.target.value)}
                                    placeholder={t("roomList.search.customerIdPlaceholder")}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                            ) : (
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <input
                                        type="text"
                                        value={staffCompanyDomain}
                                        onChange={(event) => setStaffCompanyDomain(event.target.value)}
                                        placeholder={t("roomList.search.companyDomainPlaceholder")}
                                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                    <input
                                        type="text"
                                        value={staffPersonId}
                                        onChange={(event) => setStaffPersonId(event.target.value)}
                                        placeholder={t("roomList.search.staffIdPlaceholder")}
                                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                </div>
                            )
                        ) : (
                            <input
                                type="text"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder={t("roomList.search.userPlaceholder")}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                        )}
                        {incomingRequests.length > 0 && (
                            <div className="mt-4">
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-2">{t("roomList.sections.requests")}</div>
                                <div className="space-y-2">
                                    {incomingRequests.map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 dark:border-slate-800"
                                        >
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                                    {getAccountIdLabel({
                                                        matrixUserId: item.matrixUserId,
                                                        userLocalId: item.userLocalId,
                                                    })}
                                                </div>
                                                <div className="text-xs text-slate-500 truncate dark:text-slate-400">
                                                    {getMetaLabel({
                                                        companyName: item.companyName,
                                                        title: null,
                                                        country: item.country,
                                                    })}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void onAcceptRequest(
                                                            item.requesterId,
                                                            item.matrixUserId,
                                                            item.requesterUserType,
                                                            item.matrixRoomId,
                                                        )
                                                    }
                                                    className="text-xs text-emerald-500 hover:text-emerald-400"
                                                >{t("roomList.actions.accept")}</button>
                                                <button
                                                    type="button"
                                                    onClick={() => void onRejectRequest(item.requesterId)}
                                                    className="text-xs text-rose-400 hover:text-rose-300"
                                                >{t("roomList.actions.reject")}</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {searchBusy && (
                            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t("roomList.search.searching")}</div>
                        )}
                        {searchError && <div className="mt-3 text-xs text-rose-500">{searchError}</div>}
                        <div className="mt-4 max-h-72 overflow-y-auto">
                            {/* 已選中用戶的消息輸入框 */}
                            {selectedSearchItem && (
                                <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg border border-emerald-200 dark:border-emerald-700">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                                            {t("roomList.search.sendRequestTo")}{selectedSearchItem.displayName || selectedSearchItem.id}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedSearchItem(null);
                                                setInitialMessage("");
                                                setSearchError(null);
                                            }}
                                            className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400"
                                        >{t("common.cancel")}</button>
                                    </div>
                                    <textarea
                                        placeholder={t("roomList.search.greetingPlaceholder")}
                                        value={initialMessage}
                                        onChange={(e) => setInitialMessage(e.target.value)}
                                        className="w-full px-2 py-1 text-sm rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                        rows={2}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void onRequestContact(
                                                selectedSearchItem.id,
                                                selectedSearchItem.matrixUserId,
                                                initialMessage,
                                            ).then(() => {
                                                setSelectedSearchItem(null);
                                                setInitialMessage("");
                                            });
                                        }}
                                        disabled={!initialMessage.trim()}
                                        className={`mt-2 w-full py-1.5 text-sm font-medium rounded ${initialMessage.trim()
                                            ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                            : "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-600"
                                            }`}
                                    >{t("roomList.search.sendRequest")}</button>
                                </div>
                            )}
                            {searchResults.length === 0 &&
                                (isStaffSearch
                                    ? staffSearchMode === "customer"
                                        ? Boolean(staffCustomerId.trim())
                                        : Boolean(staffCompanyDomain.trim() && staffPersonId.trim())
                                    : Boolean(query.trim())) ? (
                                <div className="text-sm text-slate-500 dark:text-slate-400">{t("roomList.empty.results")}</div>
                            ) : (
                                searchResults.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => {
                                            if (!requestedIds.has(item.id) && !acceptedIds.has(item.id)) {
                                                setSelectedSearchItem({
                                                    id: item.id,
                                                    matrixUserId: item.matrixUserId,
                                                    displayName: item.displayName,
                                                });
                                                setSearchError(null);
                                            }
                                        }}
                                        disabled={requestedIds.has(item.id) || acceptedIds.has(item.id)}
                                        className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800 ${requestedIds.has(item.id) || acceptedIds.has(item.id)
                                            ? "opacity-50 cursor-not-allowed"
                                            : selectedSearchItem?.id === item.id
                                                ? "bg-emerald-50 dark:bg-emerald-900/20 ring-1 ring-emerald-300"
                                                : ""
                                            }`}
                                    >
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                                {getAccountIdLabel(item)}
                                            </div>
                                            <div className="text-xs text-slate-500 truncate dark:text-slate-400">
                                                {getMetaLabel(item)}
                                            </div>
                                        </div>
                                        <span className="text-lg font-semibold text-emerald-500">
                                            {requestedIds.has(item.id) || acceptedIds.has(item.id) ? t("roomList.search.invited") : "+"}
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export function ensureDirectRoom(
    client: MatrixClient,
    userId: string,
): { roomId: string; isNew: boolean } | null {
    const accountData = client.getAccountData(EventType.Direct);
    const content = (accountData?.getContent() ?? {}) as Record<string, string[]>;
    const existingRooms = content[userId] ?? [];

    for (const roomId of existingRooms) {
        if (client.getRoom(roomId)) {
            return { roomId, isNew: false };
        }
    }

    return null;
}
