import type { MatrixClient } from "matrix-js-sdk";
import { EventType, Preset } from "matrix-js-sdk";

type DirectAccountData = Record<string, string[]>;

export function getDirectRoomId(client: MatrixClient, userId: string): string | null {
    const content = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as DirectAccountData;
    const roomIds = content[userId] ?? [];
    for (const roomId of roomIds) {
        if (client.getRoom(roomId)) {
            return roomId;
        }
    }
    return null;
}

export async function hideDirectRoom(client: MatrixClient, userId: string, roomId: string): Promise<void> {
    const content = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as DirectAccountData;
    const roomIds = content[userId] ?? [];
    if (!roomIds.includes(roomId)) return;
    const updated: DirectAccountData = { ...content };
    updated[userId] = roomIds.filter((id) => id !== roomId);
    await client.setAccountData(EventType.Direct, updated);
}

export async function getOrCreateDirectRoom(client: MatrixClient, userId: string): Promise<string> {
    const existing = getDirectRoomId(client, userId);
    if (existing) {
        const room = client.getRoom(existing);
        if (room) {
            const membership = room.getMyMembership();
            if (membership === "join") return existing;
            if (membership === "invite") {
                try {
                    await client.joinRoom(existing);
                    return existing;
                } catch {
                    // Fall back to creating a new direct room on the current homeserver.
                }
            }
        }
    }

    const created = await client.createRoom({
        invite: [userId],
        is_direct: true,
        preset: Preset.TrustedPrivateChat,
    });

    const content = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as DirectAccountData;
    const updated: DirectAccountData = { ...content };
    const currentRooms = new Set(updated[userId] ?? []);
    currentRooms.add(created.room_id);
    updated[userId] = Array.from(currentRooms);

    await client.setAccountData(EventType.Direct, updated);
    return created.room_id;
}
