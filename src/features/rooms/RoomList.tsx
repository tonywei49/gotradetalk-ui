import { useEffect, useMemo, useState } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { ClientEvent, EventType, RoomEvent } from "matrix-js-sdk";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { searchDirectoryAll } from "../../api/directory";
import { acceptContact, listContactRequests, listContacts, requestContact } from "../../api/contacts";
import { getOrCreateDirectRoom } from "../../matrix/direct";

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
    activeRoomId: string | null;
    onSelectRoom: (roomId: string) => void;
};

const EMPTY_STATE: DirectRoomEntry[] = [];

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
    activeRoomId,
    onSelectRoom,
}: RoomListProps) {
    const [rooms, setRooms] = useState<DirectRoomEntry[]>(EMPTY_STATE);
    const [query, setQuery] = useState("");
    const [searchBusy, setSearchBusy] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResults, setSearchResults] = useState<
        {
            id: string;
            displayName: string | null;
            userLocalId: string | null;
            companyName: string | null;
            country: string | null;
            matrixUserId: string | null;
        }[]
    >([]);
    const [showSearchModal, setShowSearchModal] = useState(false);
    const [contacts, setContacts] = useState<
        {
            id: string;
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
            displayName: string | null;
            userLocalId: string | null;
            companyName: string | null;
            country: string | null;
            matrixUserId: string | null;
        }[]
    >([]);
    const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());

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

    const searchToken = matrixAccessToken || hubAccessToken;
    const searchHsUrl = matrixAccessToken ? matrixHsUrl : null;

    useEffect(() => {
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
    }, [query, searchToken, searchHsUrl]);

    useEffect(() => {
        if (!searchToken) return;
        void (async () => {
            try {
                const [contactItems, requestItems] = await Promise.all([
                    listContacts(searchToken, searchHsUrl),
                    listContactRequests(searchToken, searchHsUrl),
                ]);
                setContacts(
                    contactItems.map((item) => ({
                        id: item.user_id,
                        displayName: item.display_name,
                        userLocalId: item.user_local_id,
                        companyName: item.company_name,
                        country: item.country,
                        matrixUserId: item.matrix_user_id,
                    })),
                );
                setIncomingRequests(
                    requestItems.map((item) => ({
                        id: item.request_id,
                        requesterId: item.requester_id,
                        displayName: item.display_name,
                        userLocalId: item.user_local_id,
                        companyName: item.company_name,
                        country: item.country,
                        matrixUserId: item.matrix_user_id,
                    })),
                );
            } catch {
                // ignore list failures
            }
        })();
    }, [searchToken, searchHsUrl]);

    const onStartChat = async (matrixUserId: string | null): Promise<void> => {
        if (!client || !matrixUserId) return;
        const roomId = await getOrCreateDirectRoom(client, matrixUserId);
        onSelectRoom(roomId);
        setShowSearchModal(false);
        setQuery("");
    };

    const onRequestContact = async (targetId: string): Promise<void> => {
        if (!searchToken) return;
        try {
            const result = await requestContact(searchToken, targetId, searchHsUrl);
            if (result.status === "pending") {
                setRequestedIds((prev) => new Set(prev).add(targetId));
            }
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : "Request failed");
        }
    };

    const onAcceptRequest = async (requesterId: string, matrixUserId: string | null): Promise<void> => {
        if (!searchToken) return;
        try {
            await acceptContact(searchToken, requesterId, searchHsUrl);
            setIncomingRequests((prev) => prev.filter((item) => item.requesterId !== requesterId));
            if (matrixUserId) {
                await onStartChat(matrixUserId);
            }
        } catch (error) {
            setSearchError(error instanceof Error ? error.message : "Accept failed");
        }
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Direct Messages
                </span>
                <button
                    type="button"
                    onClick={() => setShowSearchModal(true)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-100"
                    aria-label="Start chat"
                >
                    <PlusIcon className="h-4 w-4" />
                </button>
            </div>
            {rooms.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                    No direct chats yet.
                </div>
            ) : (
                rooms.map((entry) => (
                    <button
                        key={entry.roomId}
                        type="button"
                        onClick={() => onSelectRoom(entry.roomId)}
                        className={`w-full text-left px-4 py-3 flex gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 ${
                            entry.roomId === activeRoomId ? "bg-[#F0F7F6] dark:bg-slate-800" : ""
                        }`}
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
                ))
            )}
            {contacts.length > 0 && (
                <div className="px-4 py-4 border-t border-gray-100 dark:border-slate-800">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-2">
                        Contacts
                    </div>
                    <div className="space-y-2">
                        {contacts.map((contact) => (
                            <button
                                key={contact.id}
                                type="button"
                                onClick={() => void onStartChat(contact.matrixUserId)}
                                className="w-full text-left px-3 py-2 rounded-lg flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800"
                            >
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                        {contact.displayName || contact.userLocalId || contact.id}
                                    </div>
                                    <div className="text-xs text-slate-500 truncate dark:text-slate-400">
                                        {(contact.userLocalId || "-") +
                                            " · " +
                                            (contact.companyName || "-") +
                                            " · " +
                                            (contact.country || "-")}
                                    </div>
                                </div>
                                <span className="text-xs text-emerald-500">Chat</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {showSearchModal && (
                <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Start a chat</h3>
                            <button
                                type="button"
                                onClick={() => setShowSearchModal(false)}
                                className="rounded-full p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
                                aria-label="Close"
                            >
                                <XMarkIcon className="h-5 w-5" />
                            </button>
                        </div>
                        <input
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search user..."
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
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
                                                    {item.displayName || item.userLocalId || item.requesterId}
                                                </div>
                                                <div className="text-xs text-slate-500 truncate dark:text-slate-400">
                                                    {(item.userLocalId || "-") +
                                                        " · " +
                                                        (item.companyName || "-") +
                                                        " · " +
                                                        (item.country || "-")}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => void onAcceptRequest(item.requesterId, item.matrixUserId)}
                                                className="text-xs text-emerald-500 hover:text-emerald-400"
                                            >
                                                Accept
                                            </button>
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
                            {searchResults.length === 0 && query.trim() ? (
                                <div className="text-sm text-slate-500 dark:text-slate-400">No results.</div>
                            ) : (
                                searchResults.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => void onRequestContact(item.id)}
                                        className="w-full text-left px-3 py-2 rounded-lg flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800"
                                    >
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                                {item.displayName || item.userLocalId || item.id}
                                            </div>
                                            <div className="text-xs text-slate-500 truncate dark:text-slate-400">
                                                {(item.userLocalId || "-") +
                                                    " · " +
                                                    (item.companyName || "-") +
                                                    " · " +
                                                    (item.country || "-")}
                                            </div>
                                        </div>
                                        <span className="text-xs text-emerald-500">
                                            {requestedIds.has(item.id) ? "Requested" : "+"}
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
