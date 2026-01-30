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

export async function setDirectRoom(client: MatrixClient, userId: string, roomId: string): Promise<void> {
    const content = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as DirectAccountData;
    const updated: DirectAccountData = { ...content };
    const currentRooms = new Set(updated[userId] ?? []);
    currentRooms.add(roomId);
    updated[userId] = Array.from(currentRooms);
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
        room_version: "11",
    });

    const content = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as DirectAccountData;
    const updated: DirectAccountData = { ...content };
    const currentRooms = new Set(updated[userId] ?? []);
    currentRooms.add(created.room_id);
    updated[userId] = Array.from(currentRooms);

    await client.setAccountData(EventType.Direct, updated);
    return created.room_id;
}

/**
 * 創建 DM 房間並發送初始消息。
 * 這確保邀請事件能正確同步到被邀請方。
 */
export async function createDirectRoomWithMessage(
    client: MatrixClient,
    userId: string,
    message: string,
): Promise<string> {
    // 檢查是否已有現有房間可複用
    const existing = getDirectRoomId(client, userId);
    if (existing) {
        const room = client.getRoom(existing);
        if (room) {
            const membership = room.getMyMembership();
            if (membership === "join") {
                // 已有房間，發送消息並返回
                await client.sendTextMessage(existing, message);
                return existing;
            }
        }
    }

    // 創建新房間（使用最新版本避免升級問題）
    const created = await client.createRoom({
        invite: [userId],
        is_direct: true,
        preset: Preset.TrustedPrivateChat,
        room_version: "11",
    });

    // 更新 m.direct account data
    const content = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as DirectAccountData;
    const updated: DirectAccountData = { ...content };
    const currentRooms = new Set(updated[userId] ?? []);
    currentRooms.add(created.room_id);
    updated[userId] = Array.from(currentRooms);
    await client.setAccountData(EventType.Direct, updated);

    // 發送初始消息（這會觸發邀請同步）
    await client.sendTextMessage(created.room_id, message);

    return created.room_id;
}

/**
 * 加入已存在的 DM 房間並更新 m.direct account data。
 */
export async function joinDirectRoom(
    client: MatrixClient,
    roomId: string,
    userId: string,
): Promise<void> {
    const room = client.getRoom(roomId);
    const membership = room?.getMyMembership();

    if (membership !== "join") {
        await client.joinRoom(roomId);
    }

    // 更新 m.direct account data
    const content = (client.getAccountData(EventType.Direct)?.getContent() ?? {}) as DirectAccountData;
    const updated: DirectAccountData = { ...content };
    const currentRooms = new Set(updated[userId] ?? []);
    currentRooms.add(roomId);
    updated[userId] = Array.from(currentRooms);
    await client.setAccountData(EventType.Direct, updated);
}

