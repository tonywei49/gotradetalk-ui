import { useEffect, useMemo, useState } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { ClientEvent, EventType, RoomEvent } from "matrix-js-sdk";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { searchDirectoryAll, searchStaffDirectoryCustomers, searchStaffDirectoryEmployees } from "../../api/directory";
import {
    acceptContact,
    listContactRequests,
    listContacts,
    listOutgoingContactRequests,
    rejectContact,
    removeContact,
    requestContact,
} from "../../api/contacts";
import { getDirectRoomId, getOrCreateDirectRoom, hideDirectRoom } from "../../matrix/direct";

type DirectRoomEntry = {
    userId: string;
    roomId: string;
    room: Room;
    displayName: string;
    lastMessage: string;
    lastActive: number;
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
    view?: "chat" | "contacts";
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
            const entry: DirectRoomEntry = {
                userId,
                roomId,
                room,
                displayName: room.getMember(userId)?.name ?? userId,
                lastMessage: getLastMessagePreview(room),
                lastActive,
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
    view = "chat",
}: RoomListProps) {
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
    const [contacts, setContacts] = useState<
        {
            id: string;
            initiatedByMe: boolean;
            userType: string | null;
            displayName: string | null;
            userLocalId: string | null;
            companyName: string | null;
            country: string | null;
            matrixUserId: string | null;
        }[]
    >([]);
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
        }[]
    >([]);
    const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
    const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
    const [acceptedMatrixUserIds, setAcceptedMatrixUserIds] = useState<Set<string>>(new Set());
    const [contactSort, setContactSort] = useState<"company" | "name">("company");

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
            _event: MatrixEvent,
            room: Room | undefined,
            toStartOfTimeline: boolean | undefined,
            removed: boolean,
        ): void => {
            if (!room || removed) return;
            if (toStartOfTimeline) return;
            refresh();
        };

        const onAccountData = (event: MatrixEvent): void => {
            if (event.getType() === EventType.Direct) {
                refresh();
            }
        };

        client.on(RoomEvent.Timeline, onTimeline);
        client.on(ClientEvent.AccountData, onAccountData);

        return () => {
            client.off(RoomEvent.Timeline, onTimeline);
            client.off(ClientEvent.AccountData, onAccountData);
        };
    }, [client, refresh]);

    useEffect(() => {
        if (!rooms.length) return;
        if (!activeRoomId || !rooms.some((room) => room.roomId === activeRoomId)) {
            onSelectRoom(rooms[0].roomId);
        }
    }, [rooms, activeRoomId, onSelectRoom]);

    const hubTokenExpired = hubSessionExpiresAt ? hubSessionExpiresAt * 1000 <= Date.now() : false;
    const isStaffSearch = userType === "staff";
    const useHubToken = !isStaffSearch && Boolean(hubAccessToken) && !hubTokenExpired;
    const searchToken = useHubToken ? hubAccessToken : matrixAccessToken;
    const searchHsUrl = useHubToken ? null : matrixHsUrl;

    useEffect(() => {
        if (isStaffSearch) return;
        if (!query.trim()) {
            setSearchResults([]);
            setSearchError(null);
            return;
        }
        if (!searchToken) {
            setSearchError("Search requires access token.");
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
                    setSearchError(error instanceof Error ? error.message : "Search failed");
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
            setSearchError("Search requires access token.");
            setSearchResults([]);
            return;
        }
        if (!searchHsUrl) {
            setSearchError("Missing homeserver URL.");
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
                            setSearchError("Invalid user id.");
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
                    setSearchError(error instanceof Error ? error.message : "Search failed");
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
    }, [searchToken, searchHsUrl]);

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

    const onStartChat = async (matrixUserId: string | null): Promise<void> => {
        if (!client || !matrixUserId) return;
        const roomId = await getOrCreateDirectRoom(client, matrixUserId);
        onSelectRoom(roomId);
        setShowSearchModal(false);
        setQuery("");
        setStaffCustomerId("");
        setStaffCompanyDomain("");
        setStaffPersonId("");
    };

    const onRequestContact = async (targetId: string): Promise<void> => {
        if (!searchToken) return;
        try {
            const result = await requestContact(searchToken, targetId, searchHsUrl);
            if (result.status === "pending") {
                setRequestedIds((prev) => new Set(prev).add(targetId));
            }
            await refreshContacts();
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : "Request failed");
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
        return inviteRoom.roomId;
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
    ): Promise<void> => {
        if (!searchToken) return;
        try {
            await acceptContact(searchToken, requesterId, searchHsUrl);
            setIncomingRequests((prev) => prev.filter((item) => item.requesterId !== requesterId));
            await refreshContacts();
            if (matrixUserId && client) {
                if (userType === "staff" && requesterUserType === "client") {
                    const roomId = await getOrCreateDirectRoom(client, matrixUserId);
                    onSelectRoom(roomId);
                    setShowSearchModal(false);
                } else {
                    const joinedRoomId = await joinInviteFromUser(matrixUserId);
                    if (joinedRoomId) {
                        onSelectRoom(joinedRoomId);
                        setShowSearchModal(false);
                    }
                }
            }
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : "Accept failed");
        }
    };

    const onRejectRequest = async (requesterId: string): Promise<void> => {
        if (!searchToken) return;
        try {
            await rejectContact(searchToken, requesterId, searchHsUrl);
            setIncomingRequests((prev) => prev.filter((item) => item.requesterId !== requesterId));
            await refreshContacts();
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : "Reject failed");
        }
    };

    const onRemoveContact = async (targetId: string, matrixUserId: string | null): Promise<void> => {
        if (!searchToken) return;
        try {
            await removeContact(searchToken, targetId, searchHsUrl);
            if (client && matrixUserId) {
                const roomId = getDirectRoomId(client, matrixUserId);
                if (roomId) {
                    await hideDirectRoom(client, matrixUserId, roomId);
                }
            }
            await refreshContacts();
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : "Remove failed");
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

    const shouldCreateRoomForContact = (contact: {
        initiatedByMe: boolean;
        userType: string | null;
        matrixUserId: string | null;
    }): boolean => {
        if (!contact.matrixUserId) return false;
        if (userType === "staff") {
            if (contact.userType === "client") return true;
            if (contact.userType === "staff") return contact.initiatedByMe;
        }
        if (userType === "client") {
            if (contact.userType === "client") return contact.initiatedByMe;
            return false;
        }
        return false;
    };

    useEffect(() => {
        if (!client) return;
        void (async (): Promise<void> => {
            for (const contact of contacts) {
                if (!contact.matrixUserId) continue;
                if (!shouldCreateRoomForContact(contact)) continue;
                const existing = getDirectRoomId(client, contact.matrixUserId);
                if (!existing) {
                    await getOrCreateDirectRoom(client, contact.matrixUserId);
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
                    {view === "contacts" ? "Contacts" : "Direct Messages"}
                </span>
                <button
                    type="button"
                    onClick={() => setShowSearchModal(true)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
                    aria-label="Start chat"
                >
                    <PlusIcon className="h-5 w-5" />
                </button>
            </div>
            {view === "chat" ? (
                visibleRooms.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                        No direct chats yet.
                    </div>
                ) : (
                    visibleRooms.map((entry) => (
                        <div
                            key={entry.roomId}
                            className={`group w-full px-4 py-3 flex gap-3 items-center hover:bg-gray-50 dark:hover:bg-slate-800 ${
                                entry.roomId === activeRoomId ? "bg-[#F0F7F6] dark:bg-slate-800" : ""
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => onSelectRoom(entry.roomId)}
                                className="flex-1 min-w-0 flex items-center gap-3 text-left"
                            >
                                <div className="w-12 h-12 rounded-full bg-gray-200 flex-shrink-0 dark:bg-slate-700" />
                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <div className="flex justify-between items-baseline">
                                        <span className="font-semibold text-slate-800 truncate dark:text-slate-100">
                                            {entry.displayName}
                                        </span>
                                        <span className="text-xs text-gray-400 dark:text-slate-500">
                                            {entry.lastActive > 0 ? new Date(entry.lastActive).toLocaleTimeString() : ""}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-500 truncate dark:text-slate-400">
                                        {entry.lastMessage || " "}
                                    </p>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => void onHideRoom(entry)}
                                className="text-xs text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                Hide
                            </button>
                        </div>
                    ))
                )
            ) : (
                <div className="px-4 py-4">
                    {incomingRequests.length > 0 && (
                        <div className="mb-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-2">
                                Requests
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
                                                    )
                                                }
                                                className="text-xs text-emerald-500 hover:text-emerald-400"
                                            >
                                                Accept
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void onRejectRequest(item.requesterId)}
                                                className="text-xs text-rose-400 hover:text-rose-300"
                                            >
                                                Reject
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {contacts.length === 0 ? (
                        <div className="text-sm text-slate-500 dark:text-slate-400">No contacts yet.</div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setContactSort("company")}
                                    className={`text-xs px-2 py-1 rounded-full border ${
                                        contactSort === "company"
                                            ? "border-emerald-400 text-emerald-600"
                                            : "border-gray-200 text-slate-500"
                                    }`}
                                >
                                    By company
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setContactSort("name")}
                                    className={`text-xs px-2 py-1 rounded-full border ${
                                        contactSort === "name"
                                            ? "border-emerald-400 text-emerald-600"
                                            : "border-gray-200 text-slate-500"
                                    }`}
                                >
                                    By name
                                </button>
                            </div>
                            {sortedContacts.map((contact) => (
                                <div
                                    key={contact.id}
                                    className="w-full text-left px-3 py-2 rounded-lg flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800"
                                >
                                    <button
                                        type="button"
                                        onClick={() => void onStartChat(contact.matrixUserId)}
                                        className="min-w-0 text-left"
                                    >
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
                                    </button>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => void onStartChat(contact.matrixUserId)}
                                            className="text-xs text-emerald-500"
                                        >
                                            Chat
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void onRemoveContact(contact.id, contact.matrixUserId)}
                                            className="text-xs text-rose-400 hover:text-rose-300"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
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
                                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                                    Start a chat
                                </h3>
                                {isStaffSearch && (
                                    <div className="flex items-center rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
                                        <button
                                            type="button"
                                            onClick={() => setStaffSearchMode("customer")}
                                            className={`px-3 py-1 text-xs font-semibold rounded-full ${
                                                staffSearchMode === "customer"
                                                    ? "bg-emerald-500 text-white"
                                                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                            }`}
                                        >
                                            Customer
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStaffSearchMode("staff")}
                                            className={`px-3 py-1 text-xs font-semibold rounded-full ${
                                                staffSearchMode === "staff"
                                                    ? "bg-emerald-500 text-white"
                                                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                            }`}
                                        >
                                            Company staff
                                        </button>
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
                                aria-label="Close"
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
                                    placeholder="Customer ID"
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                            ) : (
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <input
                                        type="text"
                                        value={staffCompanyDomain}
                                        onChange={(event) => setStaffCompanyDomain(event.target.value)}
                                        placeholder="Company domain (e.g. hululucky.com)"
                                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                    <input
                                        type="text"
                                        value={staffPersonId}
                                        onChange={(event) => setStaffPersonId(event.target.value)}
                                        placeholder="Staff ID"
                                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    />
                                </div>
                            )
                        ) : (
                            <input
                                type="text"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search user..."
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                        )}
                        {incomingRequests.length > 0 && (
                            <div className="mt-4">
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-2">
                                    Requests
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
                                                        )
                                                    }
                                                    className="text-xs text-emerald-500 hover:text-emerald-400"
                                                >
                                                    Accept
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void onRejectRequest(item.requesterId)}
                                                    className="text-xs text-rose-400 hover:text-rose-300"
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {searchBusy && (
                            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">Searching...</div>
                        )}
                        {searchError && <div className="mt-3 text-xs text-rose-500">{searchError}</div>}
                        <div className="mt-4 max-h-72 overflow-y-auto">
                            {searchResults.length === 0 &&
                            (isStaffSearch
                                ? staffSearchMode === "customer"
                                    ? Boolean(staffCustomerId.trim())
                                    : Boolean(staffCompanyDomain.trim() && staffPersonId.trim())
                                : Boolean(query.trim())) ? (
                                <div className="text-sm text-slate-500 dark:text-slate-400">No results.</div>
                            ) : (
                                searchResults.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => void onRequestContact(item.id)}
                                        disabled={requestedIds.has(item.id) || acceptedIds.has(item.id)}
                                        className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800 ${
                                            requestedIds.has(item.id) || acceptedIds.has(item.id)
                                                ? "opacity-50 cursor-not-allowed"
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
                                            {requestedIds.has(item.id) || acceptedIds.has(item.id) ? "已邀請" : "+"}
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
