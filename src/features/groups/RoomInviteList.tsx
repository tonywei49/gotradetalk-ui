import React, { useEffect, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import { ClientEvent, EventType, RoomEvent } from "matrix-js-sdk";
import { UserGroupIcon, CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { mapActionErrorToMessage } from "../../utils/errorMessages";

export type RoomInvite = {
    roomId: string;
    room: Room;
    name: string;
    inviterId: string | null;
    inviterName: string | null;
    memberCount: number;
};

export type RoomInviteListProps = {
    client: MatrixClient | null;
    onAccept: (roomId: string) => void;
    onDecline: (roomId: string) => void;
};

/**
 * 鐛ㄧ珛鐨勭兢绲勯個璜嬪垪琛ㄧ祫浠躲€?
 * 瀹屽叏鐛ㄧ珛鏂肩鑱婇倧杓紝涓嶅奖闊?RoomList銆?
 */
export const RoomInviteList: React.FC<RoomInviteListProps> = ({
    client,
    onAccept,
    onDecline,
}) => {
    const { t } = useTranslation();
    const [invites, setInvites] = useState<RoomInvite[]>([]);
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
    const [joinError, setJoinError] = useState<string | null>(null);
    const [suppressedInviteIds, setSuppressedInviteIds] = useState<Set<string>>(new Set());

    const waitForJoinMembership = async (roomId: string, timeoutMs = 6000): Promise<boolean> => {
        if (!client) return false;
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const room = client.getRoom(roomId);
            if (room?.getMyMembership() === "join") return true;
            await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
        return false;
    };

    // Build pending room invitations list.
    const buildRoomInvites = (): RoomInvite[] => {
        if (!client) return [];

        const myUserId = client.getUserId();
        if (!myUserId) return [];

        return client
            .getRooms()
            .filter((room) => {
                if (suppressedInviteIds.has(room.roomId)) return false;
                const membership = room.getMyMembership();

                if (membership !== "invite") return false;
                return !room.isSpaceRoom();
            })
            .map((room) => {
                const inviteEvent = room.currentState.getStateEvents(EventType.RoomMember, myUserId);
                const inviterId = inviteEvent?.getSender() ?? null;
                const inviter = inviterId ? room.getMember(inviterId) : null;
                const fallbackName = inviter?.name || inviterId || t("room.unnamed", t("group.unnamed", "Room"));
                return {
                    roomId: room.roomId,
                    room,
                    name: room.name || fallbackName,
                    inviterId,
                    inviterName: inviter?.name ?? inviterId,
                    memberCount: room.getJoinedMemberCount() ?? 0,
                };
            });
    };

    // 鍒锋柊閭€璜嬪垪琛?
    const refresh = () => {
        setInvites(buildRoomInvites());
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
    }, [client, suppressedInviteIds]);

    const handleAccept = async (roomId: string) => {
        if (!client || processingIds.has(roomId)) return;
        setProcessingIds((prev) => new Set(prev).add(roomId));
        setSuppressedInviteIds((prev) => new Set(prev).add(roomId));
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
            // Matrix sync can lag behind /join response in some staff flows.
            // Do not block UI transition on local membership cache propagation.
            void (async () => {
                const joined = await waitForJoinMembership(roomId);
                if (!joined) {
                    await client.joinRoom(roomId).catch(() => undefined);
                    await waitForJoinMembership(roomId, 5000);
                }
                refresh();
            })();
            setInvites((prev) => prev.filter((item) => item.roomId !== roomId));
            onAccept(roomId);
            refresh();
        } catch (err) {
            setSuppressedInviteIds((prev) => {
                const next = new Set(prev);
                next.delete(roomId);
                return next;
            });
            console.error("Failed to accept room invite:", err);
            const message = mapActionErrorToMessage(t, err, "room.acceptFailed");
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
            console.error("Failed to decline room invite:", err);
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
                    {t("room.inviteTitle", t("group.inviteTitle", "Room Invitations"))} ({invites.length})
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
                                        {t("room.inviteFrom", t("group.inviteFrom", "Invited by"))} {invite.inviterName}
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
                                    title={t("room.decline", t("group.decline", "Decline"))}
                                >
                                    <XCircleIcon className="w-5 h-5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleAccept(invite.roomId)}
                                    disabled={isProcessing}
                                    className="p-1.5 rounded-full text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-50"
                                    title={t("room.accept", t("group.accept", "Accept"))}
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

