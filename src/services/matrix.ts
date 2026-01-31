import type { MatrixClient } from "matrix-js-sdk";
import { EventType } from "matrix-js-sdk";
import { useAuthStore } from "../stores/AuthStore";

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
    if (unique.length === 0) return 0;
    const results = await Promise.allSettled(unique.map((userId) => client.invite(roomId, userId)));
    const forbidden = results.find(
        (result) =>
            result.status === "rejected" &&
            result.reason &&
            typeof result.reason === "object" &&
            "httpStatus" in result.reason &&
            result.reason.httpStatus === 403,
    );
    if (forbidden) {
        throw new Error("您沒有權限邀請成員 (You are not allowed to invite users)");
    }
    return results.filter((result) => result.status === "fulfilled").length;
}
