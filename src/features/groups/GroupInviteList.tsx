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
 * 獨立的群組邀請列表組件。
 * 完全獨立於私聊邏輯，不影響 RoomList。
 */
export const GroupInviteList: React.FC<GroupInviteListProps> = ({
    client,
    onAccept,
    onDecline,
}) => {
    const { t } = useTranslation();
    const [invites, setInvites] = useState<GroupInvite[]>([]);
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

    // 構建群組邀請列表
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
                // 只處理邀請狀態的房間
                if (room.getMyMembership() !== "invite") return false;
                // 排除私聊房間（在 m.direct 中的房間）
                const kindEvent = room.currentState.getStateEvents(ROOM_KIND_EVENT, "");
                const kind = (kindEvent?.getContent() as { kind?: string } | undefined)?.kind;
                if (kind && kind !== ROOM_KIND_GROUP) return false;
                if (!kind) {
                    const memberCount = room.getJoinedMemberCount() ?? 0;
                    if (directRooms.has(room.roomId) && memberCount <= 2) return false;
                }
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

    // 刷新邀請列表
    const refresh = () => {
        setInvites(buildGroupInvites());
    };

    // 監聽事件
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
        try {
            await client.joinRoom(roomId);
            onAccept(roomId);
            refresh();
        } catch (err) {
            console.error("Failed to accept group invite:", err);
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

    // 如果沒有邀請，不渲染任何東西
    if (invites.length === 0) return null;

    return (
        <div className="border-b border-gray-200 dark:border-slate-700 pb-2 mb-2">
            <div className="px-4 py-2">
                <span className="text-xs uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400 font-medium">
                    {t("group.inviteTitle", "Group Invitations")} ({invites.length})
                </span>
            </div>
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
