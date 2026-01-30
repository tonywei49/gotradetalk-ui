import type { MatrixClient } from "matrix-js-sdk";
import { EventType, Preset, SyncState, ClientEvent } from "matrix-js-sdk";

type DirectAccountData = Record<string, string[]>;

/**
 * 等待 Matrix 客戶端完成初始同步。
 * 這確保了在創建新房間前，所有現有房間數據都已加載。
 * @param client Matrix 客戶端
 * @param timeoutMs 超時時間（默認 10 秒）
 * @returns 如果在超時前完成同步返回 true，否則返回 false
 */
export function waitForSync(client: MatrixClient, timeoutMs = 10000): Promise<boolean> {
    // 如果已經完成初始同步，直接返回
    if (client.isInitialSyncComplete()) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            client.removeListener(ClientEvent.Sync, onSync);
            resolve(false);
        }, timeoutMs);

        const onSync = (state: SyncState): void => {
            if (state === SyncState.Syncing || state === SyncState.Prepared) {
                clearTimeout(timeout);
                client.removeListener(ClientEvent.Sync, onSync);
                resolve(true);
            }
        };

        client.on(ClientEvent.Sync, onSync);
    });
}

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
    // 1. 優先從 m.direct 查找
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

    // 2. 備用邏輯：遍歷所有已加入的房間，找到與對方的 DM（可能 m.direct 未正確記錄）
    const joinedRooms = client.getRooms().filter((r) => r.getMyMembership() === "join");
    for (const room of joinedRooms) {
        const members = room.getJoinedMembers();
        // DM 房間通常只有 2 個成員
        if (members.length === 2 && members.some((m) => m.userId === userId)) {
            // 找到了，同步更新 m.direct
            await setDirectRoom(client, userId, room.roomId);
            return room.roomId;
        }
    }

    // 3. 等待 sync 完成後再次檢查，避免競態條件
    const synced = await waitForSync(client);
    if (synced) {
        // sync 完成後重新檢查是否有現有房間
        const existingAfterSync = getDirectRoomId(client, userId);
        if (existingAfterSync && client.getRoom(existingAfterSync)?.getMyMembership() === "join") {
            return existingAfterSync;
        }
        // 再次遍歷房間列表
        const roomsAfterSync = client.getRooms().filter((r) => r.getMyMembership() === "join");
        for (const room of roomsAfterSync) {
            const members = room.getJoinedMembers();
            if (members.length === 2 && members.some((m) => m.userId === userId)) {
                await setDirectRoom(client, userId, room.roomId);
                return room.roomId;
            }
        }
    }

    // 4. 確實沒有現有房間，創建新房間
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
    // 1. 優先從 m.direct 查找
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

    // 2. 備用邏輯：遍歷所有已加入的房間，找到與對方的 DM（可能 m.direct 未正確記錄）
    const joinedRooms = client.getRooms().filter((r) => r.getMyMembership() === "join");
    for (const room of joinedRooms) {
        const members = room.getJoinedMembers();
        // DM 房間通常只有 2 個成員
        if (members.length === 2 && members.some((m) => m.userId === userId)) {
            // 找到了，同步更新 m.direct
            await setDirectRoom(client, userId, room.roomId);
            // 發送消息並返回
            await client.sendTextMessage(room.roomId, message);
            return room.roomId;
        }
    }

    // 3. 等待 sync 完成後再次檢查，避免競態條件
    const synced = await waitForSync(client);
    if (synced) {
        // sync 完成後重新檢查是否有現有房間
        const existingAfterSync = getDirectRoomId(client, userId);
        if (existingAfterSync) {
            const roomAfterSync = client.getRoom(existingAfterSync);
            if (roomAfterSync?.getMyMembership() === "join") {
                await client.sendTextMessage(existingAfterSync, message);
                return existingAfterSync;
            }
        }
        // 再次遍歷房間列表
        const roomsAfterSync = client.getRooms().filter((r) => r.getMyMembership() === "join");
        for (const room of roomsAfterSync) {
            const members = room.getJoinedMembers();
            if (members.length === 2 && members.some((m) => m.userId === userId)) {
                await setDirectRoom(client, userId, room.roomId);
                await client.sendTextMessage(room.roomId, message);
                return room.roomId;
            }
        }
    }

    // 4. 確實沒有現有房間，創建新房間
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

