import React, { useState, useMemo } from "react";
import type { MatrixClient, Room, RoomMember } from "matrix-js-sdk";
import {
    UserGroupIcon,
    ArrowRightOnRectangleIcon,
    CheckCircleIcon,
    ClockIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";

export type RoomDetailsPanelProps = {
    room: Room;
    matrixClient: MatrixClient;
    onLeaveRoom: () => void;
};

type MemberStatus = "join" | "invite" | "leave" | "ban";

interface MemberInfo {
    userId: string;
    name: string;
    membership: MemberStatus;
    powerLevel: number;
}

/**
 * 獨立的聊天室詳情面板組件。
 * 保留 group 舊導出別名以兼容歷史引用。
 */
export const RoomDetailsPanel: React.FC<RoomDetailsPanelProps> = ({
    room,
    matrixClient,
    onLeaveRoom,
}) => {
    const { t } = useTranslation();
    const [leaving, setLeaving] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    // 獲取成員列表
    const members = useMemo((): MemberInfo[] => {
        const roomMembers = room.getMembers();
        const powerLevels = room.currentState.getStateEvents("m.room.power_levels", "");
        const powerLevelContent = powerLevels?.getContent()?.users ?? {};

        return roomMembers
            .map((member: RoomMember): MemberInfo => ({
                userId: member.userId,
                name: member.name || member.userId,
                membership: member.membership as MemberStatus,
                powerLevel: powerLevelContent[member.userId] ?? 0,
            }))
            .sort((a, b) => {
                // 排序：管理員 > 已加入 > 已邀請 > 其他
                if (a.powerLevel !== b.powerLevel) return b.powerLevel - a.powerLevel;
                const order = { join: 0, invite: 1, leave: 2, ban: 3 };
                return order[a.membership] - order[b.membership];
            });
    }, [room]);

    const joinedMembers = members.filter((m) => m.membership === "join");
    const invitedMembers = members.filter((m) => m.membership === "invite");

    const handleLeave = async () => {
        setLeaving(true);
        try {
            await matrixClient.leave(room.roomId);
            onLeaveRoom();
        } catch (err) {
            console.error("Failed to leave room:", err);
        } finally {
            setLeaving(false);
            setShowConfirm(false);
        }
    };

    const getMembershipIcon = (membership: MemberStatus) => {
        switch (membership) {
            case "join":
                return <CheckCircleIcon className="w-4 h-4 text-emerald-500" />;
            case "invite":
                return <ClockIcon className="w-4 h-4 text-amber-500" />;
            default:
                return <XCircleIcon className="w-4 h-4 text-slate-400" />;
        }
    };

    const getMembershipLabel = (membership: MemberStatus) => {
        switch (membership) {
            case "join":
                return t("room.memberJoined", t("group.memberJoined", "Joined"));
            case "invite":
                return t("room.memberInvited", t("group.memberInvited", "Invited"));
            case "leave":
                return t("room.memberLeft", t("group.memberLeft", "Left"));
            case "ban":
                return t("room.memberBanned", t("group.memberBanned", "Banned"));
            default:
                return "";
        }
    };

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700">
            {/* Header */}
            <div className="px-4 py-4 border-b border-gray-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                        <UserGroupIcon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {room.name || t("room.unnamed", t("group.unnamed", "Unnamed Room"))}
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {joinedMembers.length} {t("room.members", t("group.members", "members"))}
                            {invitedMembers.length > 0 && (
                                <span className="ml-2 text-amber-500">
                                    (+{invitedMembers.length} {t("room.pending", t("group.pending", "pending"))})
                                </span>
                            )}
                        </p>
                    </div>
                </div>
            </div>

            {/* Members List */}
            <div className="flex-1 overflow-y-auto">
                {/* Joined Members */}
                {joinedMembers.length > 0 && (
                    <div className="p-4">
                        <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-3">
                            {t("room.joinedMembers", t("group.joinedMembers", "Joined Members"))} ({joinedMembers.length})
                        </h3>
                        <div className="space-y-2">
                            {joinedMembers.map((member) => (
                                <div
                                    key={member.userId}
                                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
                                >
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center text-white text-sm font-semibold">
                                        {member.name[0]?.toUpperCase() || "?"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-slate-800 dark:text-slate-100 truncate text-sm">
                                            {member.name}
                                        </div>
                                        {member.powerLevel >= 100 && (
                                            <span className="text-xs text-emerald-600 dark:text-emerald-400">
                                                {t("room.admin", t("group.admin", "Admin"))}
                                            </span>
                                        )}
                                    </div>
                                    {getMembershipIcon(member.membership)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Invited Members */}
                {invitedMembers.length > 0 && (
                    <div className="p-4 border-t border-gray-100 dark:border-slate-800">
                        <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-3">
                            {t("room.invitedMembers", t("group.invitedMembers", "Invited"))} ({invitedMembers.length})
                        </h3>
                        <div className="space-y-2">
                            {invitedMembers.map((member) => (
                                <div
                                    key={member.userId}
                                    className="flex items-center gap-3 p-2 rounded-lg opacity-70"
                                >
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-200 to-amber-300 dark:from-amber-700 dark:to-amber-800 flex items-center justify-center text-white text-sm font-semibold">
                                        {member.name[0]?.toUpperCase() || "?"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-slate-800 dark:text-slate-100 truncate text-sm">
                                            {member.name}
                                        </div>
                                        <span className="text-xs text-amber-500">
                                            {getMembershipLabel(member.membership)}
                                        </span>
                                    </div>
                                    {getMembershipIcon(member.membership)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Leave Room Button */}
            <div className="p-4 border-t border-gray-200 dark:border-slate-700">
                {showConfirm ? (
                    <div className="space-y-3">
                        <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
                            {t("room.leaveConfirm", t("group.leaveConfirm", "Are you sure you want to leave this room?"))}
                        </p>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowConfirm(false)}
                                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-800"
                            >
                                {t("common.cancel", "Cancel")}
                            </button>
                            <button
                                type="button"
                                onClick={handleLeave}
                                disabled={leaving}
                                className="flex-1 px-3 py-2 rounded-lg bg-rose-500 text-white text-sm font-medium hover:bg-rose-600 disabled:opacity-50"
                            >
                                {leaving ? t("room.leaving", t("group.leaving", "Leaving...")) : t("room.leave", t("group.leave", "Leave"))}
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setShowConfirm(true)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 font-medium hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                    >
                        <ArrowRightOnRectangleIcon className="w-5 h-5" />
                        {t("room.leaveGroup", t("group.leaveGroup", "Leave Room"))}
                    </button>
                )}
            </div>
        </div>
    );
};

/**
 * 判斷房間是否為多人聊天室。
 */
export function isRoomWithMultipleMembers(room: Room): boolean {
    const members = room.getJoinedMembers();
    return members.length > 2 || !room.isSpaceRoom();
}

export type GroupDetailsPanelProps = RoomDetailsPanelProps;
export const GroupDetailsPanel = RoomDetailsPanel;
export const isGroupRoom = isRoomWithMultipleMembers;
