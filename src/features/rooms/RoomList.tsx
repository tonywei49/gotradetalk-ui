import { useEffect, useMemo, useState } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { EventType, RoomEvent } from "matrix-js-sdk";

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

export function RoomList({ client, activeRoomId, onSelectRoom }: RoomListProps) {
    const [rooms, setRooms] = useState<DirectRoomEntry[]>(EMPTY_STATE);

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
        client.on("accountData", onAccountData);

        return () => {
            client.off(RoomEvent.Timeline, onTimeline);
            client.off("accountData", onAccountData);
        };
    }, [client, refresh]);

    useEffect(() => {
        if (!rooms.length) return;
        if (!activeRoomId || !rooms.some((room) => room.roomId === activeRoomId)) {
            onSelectRoom(rooms[0].roomId);
        }
    }, [rooms, activeRoomId, onSelectRoom]);

    if (!rooms.length) {
        return <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No direct chats yet.</div>;
    }

    return (
        <div className="flex-1 overflow-y-auto">
            {rooms.map((entry) => (
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
            ))}
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
