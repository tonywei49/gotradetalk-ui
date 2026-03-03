import React, { useState, useEffect, useMemo } from "react";
import { XMarkIcon, UserGroupIcon, CheckIcon } from "@heroicons/react/24/outline";
import type { MatrixClient } from "matrix-js-sdk";
import { listContacts, type ContactEntry } from "../../api/contacts";
import { createRoomWithInvite, type HistoryVisibility } from "../../matrix/room";
import { useTranslation } from "react-i18next";
import { devLog } from "../../utils/devLog";
import { mapActionErrorToMessage } from "../../utils/errorMessages";

export type CreateRoomModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (roomId: string) => void;
    matrixClient: MatrixClient | null;
    accessToken: string | null;
    hsUrl: string | null;
};

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    matrixClient,
    accessToken,
    hsUrl,
}) => {
    const { t } = useTranslation();
    const [groupName, setGroupName] = useState("");
    const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
    const [historyVisibility, setHistoryVisibility] = useState<HistoryVisibility>("shared");
    const [contacts, setContacts] = useState<ContactEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const getLocalPart = (value: string | null | undefined): string => {
        if (!value) return "";
        const trimmed = value.startsWith("@") ? value.slice(1) : value;
        return trimmed.split(":")[0] || "";
    };
    const getUserLabel = (userId: string | null | undefined, displayName?: string | null): string => {
        const localpart = getLocalPart(userId);
        if (localpart && displayName && displayName !== localpart) {
            return `${localpart} (${displayName})`;
        }
        return localpart || displayName || userId || t("common.unknown");
    };

    // 加載聯絡人列表
    useEffect(() => {
        if (!isOpen || !accessToken) return;
        setLoading(true);
        setError(null);
        listContacts(accessToken, hsUrl)
            .then((items) => {
                // 只顯示有 matrix_user_id 的已確認聯絡人
                setContacts(items.filter((c) => c.matrix_user_id));
            })
            .catch((err) => {
                setError(mapActionErrorToMessage(t, err, "chat.inviteContactsFailed"));
            })
            .finally(() => {
                setLoading(false);
            });
    }, [isOpen, accessToken, hsUrl]);

    // 過濾聯絡人
    const filteredContacts = useMemo(() => {
        if (!searchQuery.trim()) return contacts;
        const query = searchQuery.toLowerCase();
        return contacts.filter(
            (c) =>
                c.display_name?.toLowerCase().includes(query) ||
                c.user_local_id?.toLowerCase().includes(query) ||
                c.matrix_user_id?.toLowerCase().includes(query)
        );
    }, [contacts, searchQuery]);

    // 重置表單
    useEffect(() => {
        if (isOpen) {
            setGroupName("");
            setSelectedMembers(new Set());
            setHistoryVisibility("shared");
            setSearchQuery("");
            setError(null);
        }
    }, [isOpen]);

    const toggleMember = (matrixUserId: string) => {
        setSelectedMembers((prev) => {
            const next = new Set(prev);
            if (next.has(matrixUserId)) {
                next.delete(matrixUserId);
            } else {
                next.add(matrixUserId);
            }
            return next;
        });
    };

    const handleCreate = async () => {
        if (!matrixClient || !groupName.trim() || selectedMembers.size === 0) return;
        setCreating(true);
        setError(null);
        try {
            const inviteesList = Array.from(selectedMembers);
            devLog("[CreateRoomModal] Creating room with invitees", inviteesList);
            const roomId = await createRoomWithInvite(matrixClient, {
                name: groupName.trim(),
                invitees: inviteesList,
                historyVisibility,
            });

            // 等待 SDK 同步完成，確保房間可用
            // 僅用於聊天室創建流程，不影響現有聊天邏輯
            await waitForRoomSync(matrixClient, roomId, 5000);

            onClose();
            onSuccess(roomId);
        } catch (err) {
            setError(mapActionErrorToMessage(t, err, "group.createFailed"));
        } finally {
            setCreating(false);
        }
    };

    /**
     * 等待 SDK 同步房間完成。
     * 僅用於聊天室創建後的跳轉，不影響既有流程。
     */
    const waitForRoomSync = (client: MatrixClient, roomId: string, timeoutMs: number): Promise<void> => {
        return new Promise((resolve) => {
            const room = client.getRoom(roomId);
            if (room) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                cleanup();
                // 即使超時也嘗試成功，因為房間可能已創建
                resolve();
            }, timeoutMs);

            const onRoom = (syncedRoom: { roomId: string }) => {
                if (syncedRoom.roomId === roomId) {
                    cleanup();
                    resolve();
                }
            };

            const cleanup = () => {
                clearTimeout(timeout);
                client.removeListener("Room" as any, onRoom);
            };

            client.on("Room" as any, onRoom);
        });
    };

    if (!isOpen) return null;

    const canCreate = groupName.trim().length > 0 && selectedMembers.size > 0 && !creating;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                            <UserGroupIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                            {t("group.createTitle", "Create Room")}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <XMarkIcon className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                    {/* 聊天室名稱 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {t("group.groupName", "Room Name")} <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                            placeholder={t("group.groupNamePlaceholder", "Enter room name...")}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                    </div>

                    {/* 選擇成員 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {t("group.selectMembers", "Select Members")} <span className="text-rose-500">*</span>
                            {selectedMembers.size > 0 && (
                                <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                                    ({selectedMembers.size} {t("group.selected", "selected")})
                                </span>
                            )}
                        </label>

                        {/* 搜索框 */}
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t("group.searchContacts", "Search contacts...")}
                            className="w-full px-4 py-2 mb-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />

                        {/* 聯絡人列表 */}
                        <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-xl">
                            {loading ? (
                                <div className="p-4 text-center text-slate-500">
                                    {t("group.loadingContacts", "Loading contacts...")}
                                </div>
                            ) : filteredContacts.length === 0 ? (
                                <div className="p-4 text-center text-slate-500">
                                    {t("group.noContacts", "No contacts found")}
                                </div>
                            ) : (
                                filteredContacts.map((contact) => {
                                    const matrixId = contact.matrix_user_id!;
                                    const isSelected = selectedMembers.has(matrixId);
                                    return (
                                        <button
                                            key={contact.contact_id}
                                            type="button"
                                            onClick={() => toggleMember(matrixId)}
                                            className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors border-b border-gray-100 dark:border-slate-800 last:border-b-0 ${isSelected ? "bg-emerald-50 dark:bg-emerald-900/20" : ""
                                                }`}
                                        >
                                            {/* 頭像 */}
                                            <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                                                {(contact.display_name?.[0] || contact.user_local_id?.[0] || "?").toUpperCase()}
                                                {isSelected && (
                                                    <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
                                                        <CheckIcon className="w-3 h-3 text-white" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* 名稱和公司 */}
                                            <div className="flex-1 min-w-0 text-left">
                                                <div className="font-medium text-slate-800 dark:text-slate-100 truncate">
                                                    {getUserLabel(contact.matrix_user_id, contact.display_name || contact.user_local_id)}
                                                </div>
                                            </div>

                                            {/* 選中指示器 */}
                                            <div
                                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected
                                                    ? "bg-emerald-500 border-emerald-500"
                                                    : "border-gray-300 dark:border-slate-600"
                                                    }`}
                                            >
                                                {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* 歷史紀錄設定 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                            {t("group.historySettings", "History Visibility")}
                        </label>
                        <div className="space-y-2">
                            <label
                                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${historyVisibility === "shared"
                                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                                    : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="historyVisibility"
                                    value="shared"
                                    checked={historyVisibility === "shared"}
                                    onChange={() => setHistoryVisibility("shared")}
                                    className="mt-1 accent-emerald-500"
                                />
                                <div>
                                    <div className="font-medium text-slate-800 dark:text-slate-100">
                                        {t("group.historyShared", "Share Full History")}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                        {t("group.historySharedDesc", "New members can see all previous messages")}
                                    </div>
                                </div>
                            </label>

                            <label
                                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${historyVisibility === "joined"
                                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                                    : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="historyVisibility"
                                    value="joined"
                                    checked={historyVisibility === "joined"}
                                    onChange={() => setHistoryVisibility("joined")}
                                    className="mt-1 accent-emerald-500"
                                />
                                <div>
                                    <div className="font-medium text-slate-800 dark:text-slate-100">
                                        {t("group.historyJoined", "New Messages Only")}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                        {t("group.historyJoinedDesc", "New members can only see messages after joining")}
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* 錯誤提示 */}
                    {error && (
                        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-gray-200 dark:border-slate-700 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                    >
                        {t("common.cancel", "Cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={handleCreate}
                        disabled={!canCreate}
                        className={`flex-1 px-4 py-3 rounded-xl font-medium transition-colors ${canCreate
                            ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                            : "bg-gray-200 dark:bg-slate-700 text-gray-400 dark:text-slate-500 cursor-not-allowed"
                            }`}
                    >
                        {creating ? t("group.creating", "Creating...") : t("group.create", "Create Room")}
                    </button>
                </div>
            </div>
        </div>
    );
};
