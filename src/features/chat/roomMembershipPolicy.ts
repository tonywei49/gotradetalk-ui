import { ROOM_KIND_DIRECT, ROOM_KIND_GROUP } from "../../constants/roomKinds";

export type PowerLevelContent = {
    users?: Record<string, number>;
    users_default?: number;
    events?: Record<string, number>;
    events_default?: number;
    state_default?: number;
    invite?: number;
};

export function hasDirectByAccountData(
    accountDataContent: Record<string, unknown> | undefined,
    roomId: string | null,
): boolean {
    if (!accountDataContent || typeof accountDataContent !== "object" || !roomId) return false;
    return Object.values(accountDataContent).some((value) => {
        if (!Array.isArray(value)) return false;
        return value.some((candidateRoomId) => candidateRoomId === roomId);
    });
}

export function hasDirectByMembers(params: {
    isSpaceRoom: boolean;
    joinedMemberIds: string[];
    invitedMemberIds: string[];
    selfUserId?: string | null;
}): boolean {
    const { isSpaceRoom, joinedMemberIds, invitedMemberIds, selfUserId } = params;
    if (isSpaceRoom) return false;
    const others = Array.from(new Set([...joinedMemberIds, ...invitedMemberIds])).filter(
        (memberId) => memberId && memberId !== selfUserId,
    );
    return others.length === 1;
}

export function isDirectRoomByPolicy(params: {
    isSpaceRoom: boolean;
    roomKind?: string | null;
    isDirectByAccountData: boolean;
    isDirectByMembers: boolean;
}): boolean {
    const { isSpaceRoom, roomKind, isDirectByAccountData, isDirectByMembers } = params;
    if (isSpaceRoom) return false;
    if (roomKind === ROOM_KIND_DIRECT) return true;
    if (roomKind === ROOM_KIND_GROUP) return false;
    if (isDirectByAccountData) return true;
    return isDirectByMembers;
}

export function resolveDirectPeerUserId(
    joinedMemberIds: string[],
    invitedMemberIds: string[],
    selfUserId?: string | null,
): string | null {
    const allMembers = Array.from(new Set([...joinedMemberIds, ...invitedMemberIds]));
    return allMembers.find((memberId) => memberId && memberId !== selfUserId) ?? null;
}

export function deriveRoomPermissions(
    powerLevels: PowerLevelContent | null,
    selfUserId?: string | null,
): {
    userPowerLevel: number;
    inviteLevel: number;
    canManageInvites: boolean;
    canInviteMembers: boolean;
    canRenameRoom: boolean;
    canRenameGroup: boolean;
    canRemoveMembers: boolean;
} {
    const defaultLevel = powerLevels?.users_default ?? 0;
    const userPowerLevel = selfUserId ? (powerLevels?.users?.[selfUserId] ?? defaultLevel) : defaultLevel;
    const inviteLevel = powerLevels?.invite ?? 0;

    return {
        userPowerLevel,
        inviteLevel,
        canManageInvites: userPowerLevel >= 100,
        canInviteMembers: userPowerLevel >= inviteLevel,
        canRenameRoom: userPowerLevel >= 50,
        canRenameGroup: userPowerLevel >= 50,
        canRemoveMembers: userPowerLevel >= 50,
    };
}
