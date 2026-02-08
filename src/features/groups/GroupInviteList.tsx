import React, { useEffect, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { ClientEvent, EventType, RoomEvent } from "matrix-js-sdk";
import { UserGroupIcon, CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { ROOM_KIND_EVENT, ROOM_KIND_GROUP } from "../../constants/roomKinds";

export type GroupInvite = {
    roomId: string;
    room: Room;
    name: string;
    inviterId: string | null;
    inviterName: string | null;
    memberCount: number;
};

export type GroupInviteListProps = {
    client: MatrixClient | null;
    onAccept: (roomId: string) => void;
    onDecline: (roomId: string) => void;
};

/**
 * 鐛ㄧ珛鐨勭兢绲勯個璜嬪垪琛ㄧ祫浠躲€?
 * 瀹屽叏鐛ㄧ珛鏂肩鑱婇倧杓紝涓嶅奖闊?RoomList銆?
 */
export const GroupInviteList: React.FC<GroupInviteListProps> = ({
    client,
    onAccept,
    onDecline,
}) => {
    const { t } = useTranslation();
    const [invites, setInvites] = useState<GroupInvite[]>([]);
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
    const [joinError, setJoinError] = useState<string | null>(null);

    // 妲嬪缓缇ょ祫閭€璜嬪垪琛?
    const buildGroupInvites = (): GroupInvite[] => {
        if (!client) return [];

        const directRooms = new Set<string>();
        const accountData = client.getAccountData(EventType.Direct);
        const directContent = (accountData?.getContent() ?? {}) as Record<string, string[]>;
        Object.values(directContent).forEach((roomIds) => {
            roomIds.forEach((roomId) => directRooms.add(roomId));
        });

        const myUserId = client.getUserId();
        if (!myUserId) return [];

        return client
            .getRooms()
            .filter((room) => {
                const membership = room.getMyMembership();
                const kindEvent = room.currentState.getStateEvents(ROOM_KIND_EVENT, "");
                const kind = (kindEvent?.getContent() as { kind?: string } | undefined)?.kind;
                const isDirect = directRooms.has(room.roomId);
                const memberCount = room.getJoinedMemberCount() ?? 0;

                // 妾㈡煡鎴愬摗浜嬩欢涓殑 is_direct 灞€?
                const memberEvent = room.currentState.getStateEvents(EventType.RoomMember, myUserId);
                const isDirectFromMemberEvent = Boolean(memberEvent?.getContent()?.is_direct);

                // 鍙檿鐞嗛個璜嬬媭鎱嬬殑鎴块枔
                if (membership !== "invite") return false;

                // 濡傛灉鏈?room_kind锛屾牴鎿氬畠鍒ゆ柗
                if (kind) {
                    return kind === ROOM_KIND_GROUP;
                }

                if (!room.name) return false;
                // 濡傛灉娌掓湁 room_kind锛屼娇鐢ㄥ叾浠栨柟寮忓垽鏂?
                // 鎺掗櫎绉佽亰閭€璜嬶紙is_direct 鐐?true 鎴栧湪 m.direct 涓級
                if (isDirectFromMemberEvent) return false;
                if (isDirect && memberCount <= 2) return false;

                return true;
            })
            .map((room) => {
                const inviteEvent = room.currentState.getStateEvents(EventType.RoomMember, myUserId);
                const inviterId = inviteEvent?.getSender() ?? null;
                const inviter = inviterId ? room.getMember(inviterId) : null;
                return {
                    roomId: room.roomId,
                    room,
                    name: room.name || t("group.unnamed", "Group"),
                    inviterId,
                    inviterName: inviter?.name ?? inviterId,
                    memberCount: room.getJoinedMemberCount() ?? 0,
                };
            });
    };

    // 鍒锋柊閭€璜嬪垪琛?
    const refresh = () => {
        setInvites(buildGroupInvites());
    };

    // 鐩ｈ伣浜嬩欢
    useEffect(() => {
        if (!client) {
            setInvites([]);
            return undefined;
        }

        refresh();

        const onRoom = () => refresh();
        const onMembership = () => refresh();

        client.on("Room" as any, onRoom);
        client.on(RoomEvent.MyMembership, onMembership);
        client.on(ClientEvent.Sync, refresh);

        return () => {
            client.off("Room" as any, onRoom);
            client.off(RoomEvent.MyMembership, onMembership);
            client.off(ClientEvent.Sync, refresh);
        };
    }, [client]);

    const handleAccept = async (roomId: string) => {
        if (!client || processingIds.has(roomId)) return;
        setProcessingIds((prev) => new Set(prev).add(roomId));
        setJoinError(null);
        try {
            const room = client.getRoom(roomId);
            const myUserId = client.getUserId();
            const inviteEvent =
                room && myUserId ? room.currentState.getStateEvents(EventType.RoomMember, myUserId) : null;
            const inviterId = inviteEvent?.getSender() ?? null;
            const viaServer = inviterId ? inviterId.split(":")[1] : undefined;
            if (viaServer) {
                await client.joinRoom(roomId, { viaServers: [viaServer] });
            } else {
                await client.joinRoom(roomId);
            }
            onAccept(roomId);
            refresh();
        } catch (err) {
            console.error("Failed to accept group invite:", err);
            const message =
                err instanceof Error
                    ? err.message
                    : typeof err === "string"
                        ? err
                        : t("group.acceptFailed", "Failed to accept invite");
            setJoinError(message);
        } finally {
            setProcessingIds((prev) => {
                const next = new Set(prev);
                next.delete(roomId);
                return next;
            });
        }
    };

    const handleDecline = async (roomId: string) => {
        if (!client || processingIds.has(roomId)) return;
        setProcessingIds((prev) => new Set(prev).add(roomId));
        try {
            await client.leave(roomId);
            onDecline(roomId);
            refresh();
        } catch (err) {
            console.error("Failed to decline group invite:", err);
        } finally {
            setProcessingIds((prev) => {
                const next = new Set(prev);
                next.delete(roomId);
                return next;
            });
        }
    };

    // 濡傛灉娌掓湁閭€璜嬶紝涓嶆覆鏌撲换浣曟澅瑗?
    if (invites.length === 0) return null;

    return (
        <div className="border-b border-gray-200 dark:border-slate-700 pb-2 mb-2">
            <div className="px-4 py-2">
                <span className="text-xs uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400 font-medium">
                    {t("group.inviteTitle", "Group Invitations")} ({invites.length})
                </span>
            </div>
            {joinError && (
                <div className="mx-4 mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-900/20 dark:text-rose-300">
                    {joinError}
                </div>
            )}
            <div className="space-y-1 px-2">
                {invites.map((invite) => {
                    const isProcessing = processingIds.has(invite.roomId);
                    return (
                        <div
                            key={invite.roomId}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                        >
                            {/* Icon */}
                            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-800/30 flex items-center justify-center flex-shrink-0">
                                <UserGroupIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-slate-800 dark:text-slate-100 truncate text-sm">
                                    {invite.name}
                                </div>
                                {invite.inviterName && (
                                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                        {t("group.inviteFrom", "Invited by")} {invite.inviterName}
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-1 flex-shrink-0">
                                <button
                                    type="button"
                                    onClick={() => handleDecline(invite.roomId)}
                                    disabled={isProcessing}
                                    className="p-1.5 rounded-full text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/30 disabled:opacity-50"
                                    title={t("group.decline", "Decline")}
                                >
                                    <XCircleIcon className="w-5 h-5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleAccept(invite.roomId)}
                                    disabled={isProcessing}
                                    className="p-1.5 rounded-full text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-50"
                                    title={t("group.accept", "Accept")}
                                >
                                    <CheckCircleIcon className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

