import type { MatrixClient } from "matrix-js-sdk";
import { EventType } from "matrix-js-sdk";

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

export async function getOrCreateDirectRoom(client: MatrixClient, userId: string): Promise<string> {
    const existing = getDirectRoomId(client, userId);
    if (existing) return existing;

    const created = await client.createRoom({
        invite: [userId],
        is_direct: true,
        preset: "trusted_private_chat",
    });

    const content = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as DirectAccountData;
    const updated: DirectAccountData = { ...content };
    const currentRooms = new Set(updated[userId] ?? []);
    currentRooms.add(created.room_id);
    updated[userId] = Array.from(currentRooms);

    await client.setAccountData(EventType.Direct, updated);
    return created.room_id;
}
