import type { MatrixClient } from "matrix-js-sdk";
import { EventType, MatrixError } from "matrix-js-sdk";
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
    const hsUrl = (client as { getHomeserverUrl?: () => string | null }).getHomeserverUrl?.() ?? null;
    try {
        const createEvent = await client.getStateEvent(roomId, "m.room.create", "");
        const roomVersion = (createEvent as { room_version?: string } | null)?.room_version ?? "unknown";
        const federate = (createEvent as { [key: string]: unknown } | null)?.["m.federate"];
        console.log("[inviteUsersToRoom] Room create:", { roomId, roomVersion, federate });
    } catch (error) {
        console.warn("[inviteUsersToRoom] Failed to read room create event:", { roomId, error });
    }
    console.log("[inviteUsersToRoom] Inviting users:", {
        roomId,
        userIds: unique,
        fromUserId: client.getUserId(),
        hsUrl,
    });
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
            throw new Error("You are not allowed to invite users");
        }
    }

    const alreadyJoined: string[] = [];
    const alreadyInvited: string[] = [];
    const bannedUsers: string[] = [];
    const pendingInvites: string[] = [];
    if (room) {
        for (const userId of unique) {
            const member = room.getMember(userId);
            const membership = member?.membership;
            if (membership === "join") {
                alreadyJoined.push(userId);
                continue;
            }
            if (membership === "invite") {
                alreadyInvited.push(userId);
                continue;
            }
            if (membership === "ban") {
                bannedUsers.push(userId);
                continue;
            }
            pendingInvites.push(userId);
        }
    } else {
        pendingInvites.push(...unique);
    }

    if (pendingInvites.length === 0) {
        const parts = [
            alreadyJoined.length > 0 ? `Already joined: ${alreadyJoined.join(", ")}` : null,
            alreadyInvited.length > 0 ? `Already invited: ${alreadyInvited.join(", ")}` : null,
            bannedUsers.length > 0 ? `Banned: ${bannedUsers.join(", ")}` : null,
        ].filter((part): part is string => Boolean(part));
        throw new Error(parts.length > 0 ? parts.join("; ") : "No users to invite");
    }

    const results = await Promise.allSettled(
        pendingInvites.map(async (userId) => {
            console.log("[inviteUsersToRoom] Inviting:", { roomId, userId, hsUrl });
            const result = await client.invite(roomId, userId);
            console.log("[inviteUsersToRoom] Invite success:", { roomId, userId });
            const membership = room?.getMember(userId)?.membership ?? null;
            console.log("[inviteUsersToRoom] Invite membership (immediate):", { roomId, userId, membership });
            if (room) {
                setTimeout(() => {
                    const delayedMembership = room.getMember(userId)?.membership ?? null;
                    console.log("[inviteUsersToRoom] Invite membership (delayed):", {
                        roomId,
                        userId,
                        membership: delayedMembership,
                    });
                }, 3000);
            }
            return result;
        }),
    );
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
        throw new Error("You are not allowed to invite users");
    }

    const failures = results
        .map((result, index) => {
            if (result.status !== "rejected") return null;
            const reason = result.reason as
                | { errcode?: string; message?: string; error?: string; httpStatus?: number }
                | MatrixError
                | null;
            const errcode = (reason as { errcode?: string } | null)?.errcode;
            let detail = errcode || (reason as { message?: string } | null)?.message || "unknown error";
            if (errcode === "M_FORBIDDEN") detail = "No invite permission";
            if (errcode === "M_NOT_FOUND" || errcode === "M_USER_NOT_FOUND") detail = "User not found";
            if (errcode === "M_UNSUPPORTED_ROOM_VERSION") detail = "Unsupported room version";
            if (errcode === "M_BAD_STATE") detail = "Room state error";
            return `${pendingInvites[index]}: ${detail}`;
        })
        .filter((value): value is string => value !== null);
    if (alreadyJoined.length > 0) {
        failures.push(`Already joined: ${alreadyJoined.join(", ")}`);
    }
    if (alreadyInvited.length > 0) {
        failures.push(`Already invited: ${alreadyInvited.join(", ")}`);
    }
    if (bannedUsers.length > 0) {
        failures.push(`Banned: ${bannedUsers.join(", ")}`);
    }
    if (failures.length > 0) {
        throw new Error(`Some invites failed: ${failures.join("; ")}`);
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
