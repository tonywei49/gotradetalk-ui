import { useEffect, useMemo, useState } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { ClientEvent, EventType, RoomEvent } from "matrix-js-sdk";

import type { AuthUserType } from "../../stores/AuthStore";
import { searchDirectoryCustomers, searchDirectoryEmployees } from "../../api/directory";
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
    userType: AuthUserType | null;
    hubAccessToken: string | null;
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

    Object.entries(content).forEach(([userId, roomIds]) => {
        roomIds.forEach((roomId) => {
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

export function RoomList({ client, userType, hubAccessToken, activeRoomId, onSelectRoom }: RoomListProps) {
    const [rooms, setRooms] = useState<DirectRoomEntry[]>(EMPTY_STATE);
    const [query, setQuery] = useState("");
    const [searchBusy, setSearchBusy] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchResults, setSearchResults] = useState<
        { id: string; name: string; matrixUserId: string | null }[]
    >([]);

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

    useEffect(() => {
        if (!query.trim()) {
            setSearchResults([]);
            setSearchError(null);
            return;
        }
        if (!hubAccessToken) {
            setSearchError("Search requires hub access.");
            setSearchResults([]);
            return;
        }

        const handler = window.setTimeout(() => {
            void (async () => {
                setSearchBusy(true);
                setSearchError(null);
                try {
                    if (userType === "staff") {
                        const results = await searchDirectoryCustomers(query.trim(), hubAccessToken);
                        setSearchResults(
                            results.map((item) => ({
                                id: item.customer_user_id,
                                name: item.display_name || item.handle || item.customer_user_id,
                                matrixUserId: item.matrix_user_id ?? null,
                            })),
                        );
                    } else {
                        const results = await searchDirectoryEmployees(query.trim(), hubAccessToken);
                        setSearchResults(
                            results.map((item) => ({
                                id: item.person_id,
                                name: item.display_name || item.username || item.person_id,
                                matrixUserId: item.matrix_user_id ?? null,
                            })),
                        );
                    }
                } catch (error) {
                    setSearchError(error instanceof Error ? error.message : "Search failed");
                    setSearchResults([]);
                } finally {
                    setSearchBusy(false);
                }
            })();
        }, 350);

        return () => window.clearTimeout(handler);
    }, [query, hubAccessToken, userType]);

    const onStartChat = async (matrixUserId: string | null): Promise<void> => {
        if (!client || !matrixUserId) return;
        const roomId = await getOrCreateDirectRoom(client, matrixUserId);
        onSelectRoom(roomId);
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="px-4 pt-2 pb-3">
                <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search user..."
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                {searchBusy && <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Searching...</div>}
                {searchError && <div className="mt-2 text-xs text-rose-500">{searchError}</div>}
            </div>
            {searchResults.length > 0 && (
                <div className="border-t border-gray-100 dark:border-slate-800">
                    {searchResults.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => void onStartChat(item.matrixUserId)}
                            className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800"
                        >
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-800 truncate dark:text-slate-100">
                                    {item.name}
                                </div>
                                <div className="text-xs text-slate-500 truncate dark:text-slate-400">
                                    {item.matrixUserId ?? "No matrix account"}
                                </div>
                            </div>
                            <span className="text-xs text-emerald-500">Chat</span>
                        </button>
                    ))}
                </div>
            )}
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
