import type { MatrixClient } from "matrix-js-sdk";
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
        const event = room.currentState.getStateEvents("m.room.power_levels", "");
        content = (event?.getContent() ?? null) as PowerLevelContent | null;
    }
    if (!content) {
        const eventContent = (await client.getStateEvent(
            roomId,
            "m.room.power_levels",
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

    await client.sendStateEvent(roomId, "m.room.power_levels", nextContent);
}
