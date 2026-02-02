import type { MatrixClient } from "matrix-js-sdk";
import { EventType } from "matrix-js-sdk";
import { useAuthStore } from "../stores/AuthStore";
import { DEPRECATED_DM_PREFIX, DEPRECATED_DM_SEPARATOR } from "../constants/rooms";

type PowerLevelContent = {
    invite?: number;
    users?: Record<string, number>;
    users_default?: number;
    state_default?: number;
    events_default?: number;
    events?: Record<string, number>;
    ban?: number;
    kick?: number;
    redact?: number;
};

function getMatrixClient(): MatrixClient {
    const client = useAuthStore.getState().matrixClient;
    if (!client) {
        throw new Error("Matrix client unavailable");
    }
    return client;
}

export async function updateRoomInvitePermission(roomId: string, allowMembersToInvite: boolean): Promise<void> {
    const client = getMatrixClient();
    let content: PowerLevelContent | null = null;
    const room = client.getRoom(roomId);
    if (room) {
        const event = room.currentState.getStateEvents(EventType.RoomPowerLevels, "");
        content = (event?.getContent() ?? null) as PowerLevelContent | null;
    }
    if (!content) {
        const eventContent = (await client.getStateEvent(
            roomId,
            EventType.RoomPowerLevels,
            "",
        )) as PowerLevelContent;
        content = eventContent ?? {};
    }

    const nextContent: PowerLevelContent = {
        ...content,
        users: { ...(content.users ?? {}) },
        events: { ...(content.events ?? {}) },
    };

    nextContent.invite = allowMembersToInvite ? 0 : 50;

    await client.sendStateEvent(roomId, EventType.RoomPowerLevels, nextContent);
}

export async function inviteUsersToRoom(roomId: string, userIds: string[]): Promise<number> {
    const client = getMatrixClient();
    const unique = Array.from(new Set(userIds.filter((userId) => userId.trim())));
    console.log("[inviteUsersToRoom] Inviting users:", { roomId, userIds: unique });
    if (unique.length === 0) return 0;

    const room = client.getRoom(roomId);
    const currentUserId = client.getUserId();
    let powerLevels: PowerLevelContent | null = null;
    if (room) {
        const event = room.currentState.getStateEvents(EventType.RoomPowerLevels, "");
        powerLevels = (event?.getContent() ?? null) as PowerLevelContent | null;
    }
    if (!powerLevels) {
        try {
            const eventContent = (await client.getStateEvent(
                roomId,
                EventType.RoomPowerLevels,
                "",
            )) as PowerLevelContent;
            powerLevels = eventContent ?? {};
        } catch {
            powerLevels = null;
        }
    }
    if (powerLevels && currentUserId) {
        const myLevel = powerLevels.users?.[currentUserId] ?? powerLevels.users_default ?? 0;
        const inviteLevel = powerLevels.invite ?? 0;
        if (myLevel < inviteLevel) {
            throw new Error("您沒有權限邀請成員 (You are not allowed to invite users)");
        }
    }

    const results = await Promise.allSettled(unique.map((userId) => client.invite(roomId, userId)));
    console.log("[inviteUsersToRoom] Invite results:", results);
    const forbidden = results.find((result) => {
        if (result.status !== "rejected") return false;
        const reason = result.reason as { httpStatus?: number; errcode?: string } | null;
        if (!reason) return false;
        if (reason.httpStatus === 403) return true;
        if (reason.errcode === "M_FORBIDDEN") return true;
        return false;
    });
    if (forbidden) {
        throw new Error("您沒有權限邀請成員 (You are not allowed to invite users)");
    }

    const failures = results
        .map((result, index) => {
            if (result.status !== "rejected") return null;
            const reason = result.reason as
                | { errcode?: string; message?: string; error?: string; httpStatus?: number }
                | null;
            const detail = reason?.errcode || reason?.message || reason?.error || "unknown error";
            return `${unique[index]}: ${detail}`;
        })
        .filter((value): value is string => value !== null);
    if (failures.length > 0) {
        throw new Error(`部分邀請失敗: ${failures.join(", ")}`);
    }

    return results.filter((result) => result.status === "fulfilled").length;
}

export async function markRoomDeprecated(roomId: string): Promise<void> {
    const client = getMatrixClient();
    const room = client.getRoom(roomId);
    const currentName = room?.name || "";
    const nextName = currentName.startsWith(DEPRECATED_DM_PREFIX)
        ? currentName
        : `${DEPRECATED_DM_PREFIX}${DEPRECATED_DM_SEPARATOR}${currentName || roomId}`;
    if (nextName !== currentName) {
        await client.setRoomName(roomId, nextName);
    }

    const event = room?.currentState.getStateEvents(EventType.RoomPowerLevels, "");
    const content = (event?.getContent() ?? {}) as PowerLevelContent;
    const nextContent: PowerLevelContent = {
        ...content,
        users: { ...(content.users ?? {}) },
        events: { ...(content.events ?? {}) },
        users_default: content.users_default ?? 0,
        events_default: 50,
    };
    await client.sendStateEvent(roomId, EventType.RoomPowerLevels, nextContent);
}
