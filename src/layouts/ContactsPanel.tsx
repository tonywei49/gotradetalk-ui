import React, { useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { MatrixClient } from "matrix-js-sdk";
import type { ContactSummary } from "../features/rooms/RoomList";
import type { HubMatrixCredentials } from "../api/types";
import { DEPRECATED_DM_PREFIX } from "../constants/rooms";
import { MATRIX_PRESET_PRIVATE_CHAT } from "../matrix/matrixEventConstants";
import { translationLanguageOptions } from "../constants/translationLanguages";

export interface SharedContactRoomEntry {
    roomId: string;
    displayName: string;
    memberCount: number;
    lastActive: number;
}

interface ContactsPanelProps {
    matrixClient: MatrixClient | null;
    matrixCredentials: HubMatrixCredentials | null;
    activeContact: ContactSummary | null;
    setActiveContact: (contact: ContactSummary | null) => void;
    showContactMenu: boolean;
    setShowContactMenu: React.Dispatch<React.SetStateAction<boolean>>;
    showRemoveContactConfirm: boolean;
    setShowRemoveContactConfirm: React.Dispatch<React.SetStateAction<boolean>>;
    setContactsRefreshToken: React.Dispatch<React.SetStateAction<number>>;
    selectedSharedRoomId: string | null;
    setSelectedSharedRoomId: React.Dispatch<React.SetStateAction<string | null>>;
    creatingContactRoom: boolean;
    setCreatingContactRoom: (loading: boolean) => void;
    contactRoomActionError: string | null;
    setContactRoomActionError: (error: string | null) => void;
    setActiveRoomId: (roomId: string | null) => void;
    setActiveTab: (tab: "chat" | "notebook" | "contacts" | "files" | "tasks" | "settings" | "account") => void;
    setMobileView: (view: "list" | "detail") => void;
    getContactLabel: (contact: ContactSummary | null) => string;
    getContactAvatarUrl: (matrixUserId?: string | null) => string | null;
    returnToMobileList: () => void;
    hubAccessToken: string | null;
    hubSessionExpiresAt?: number | null;
}

const ContactsPanel: React.FC<ContactsPanelProps> = ({
    matrixClient,
    matrixCredentials,
    activeContact,
    setActiveContact,
    showContactMenu,
    setShowContactMenu,
    showRemoveContactConfirm,
    setShowRemoveContactConfirm,
    setContactsRefreshToken,
    selectedSharedRoomId,
    setSelectedSharedRoomId,
    creatingContactRoom,
    setCreatingContactRoom,
    contactRoomActionError,
    setContactRoomActionError,
    setActiveRoomId,
    setActiveTab,
    setMobileView,
    getContactLabel,
    getContactAvatarUrl,
    returnToMobileList,
    hubAccessToken,
    hubSessionExpiresAt,
}) => {
    const { t } = useTranslation();
    const contactMenuRef = useRef<HTMLDivElement | null>(null);
    const contactMenuButtonRef = useRef<HTMLButtonElement | null>(null);

    const matrixAccessToken = matrixCredentials?.access_token ?? null;
    const matrixHsUrl = matrixCredentials?.hs_url ?? null;
    const hubTokenExpired = hubSessionExpiresAt ? hubSessionExpiresAt * 1000 < Date.now() : false;
    const useHubToken = Boolean(hubAccessToken) && !hubTokenExpired;
    const actionToken = useHubToken ? hubAccessToken : matrixAccessToken;
    const actionHsUrl = useHubToken ? null : matrixHsUrl;

    const matrixHost = useMemo(() => {
        if (!matrixHsUrl) return null;
        try {
            return new URL(matrixHsUrl).host;
        } catch {
            return null;
        }
    }, [matrixHsUrl]);

    const resolveActiveContactMatrixUserId = useCallback((): string | null => {
        if (!activeContact) return null;
        return activeContact.matrixUserId ||
            (activeContact.userLocalId && matrixHost ? `@${activeContact.userLocalId}:${matrixHost}` : null);
    }, [activeContact, matrixHost]);

    const sharedRoomsWithActiveContact = useMemo<SharedContactRoomEntry[]>(() => {
        if (!matrixClient || !activeContact) return [];
        const matrixUserId = resolveActiveContactMatrixUserId();
        if (!matrixUserId) return [];
        return matrixClient
            .getRooms()
            .filter((room) => {
                if (room.getMyMembership() !== "join") return false;
                if (room.isSpaceRoom()) return false;
                if (room.name?.startsWith(DEPRECATED_DM_PREFIX)) return false;
                const membership = room.getMember(matrixUserId)?.membership;
                return membership === "join" || membership === "invite";
            })
            .map((room) => {
                const memberCount = new Set(
                    room
                        .getMembers()
                        .filter((member) => member.membership === "join" || member.membership === "invite")
                        .map((member) => member.userId),
                ).size;
                return {
                    roomId: room.roomId,
                    displayName: room.name || room.roomId,
                    memberCount: memberCount || room.getJoinedMembers().length || 2,
                    lastActive: room.getLastActiveTimestamp(),
                };
            })
            .sort((a, b) => b.lastActive - a.lastActive);
    }, [activeContact, matrixClient, resolveActiveContactMatrixUserId]);

    useEffect(() => {
        if (sharedRoomsWithActiveContact.length === 0) {
            setSelectedSharedRoomId(null);
            return;
        }
        setSelectedSharedRoomId((prev) => {
            if (prev && sharedRoomsWithActiveContact.some((room) => room.roomId === prev)) return prev;
            return sharedRoomsWithActiveContact[0].roomId;
        });
    }, [sharedRoomsWithActiveContact, setSelectedSharedRoomId]);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent): void => {
            const target = event.target as Node;
            if (contactMenuRef.current?.contains(target) || contactMenuButtonRef.current?.contains(target)) return;
            setShowContactMenu(false);
        };
        if (showContactMenu) {
            document.addEventListener("click", onClickOutside);
        }
        return () => {
            document.removeEventListener("click", onClickOutside);
        };
    }, [showContactMenu, setShowContactMenu]);

    const onStartChatFromContactDetail = async (): Promise<void> => {
        if (!selectedSharedRoomId) {
            setContactRoomActionError(t("layout.sharedRoomsSelectFirst"));
            return;
        }
        setContactRoomActionError(null);
        setActiveRoomId(selectedSharedRoomId);
        setActiveTab("chat");
        setMobileView("detail");
    };

    const onCreateContactRoom = async (): Promise<void> => {
        if (!matrixClient || !activeContact) return;
        const currentUserId = matrixClient.getUserId();
        if (!currentUserId) {
            setContactRoomActionError(t("layout.sharedRoomsCreateFailed"));
            return;
        }
        const matrixUserId = resolveActiveContactMatrixUserId();
        if (!matrixUserId) {
            setContactRoomActionError(t("layout.sharedRoomsNoMatrixId"));
            return;
        }
        setContactRoomActionError(null);
        setCreatingContactRoom(true);
        try {
            const result = await matrixClient.createRoom({
                invite: [matrixUserId],
                preset: MATRIX_PRESET_PRIVATE_CHAT as never,
                power_level_content_override: {
                    users: {
                        [currentUserId]: 100,
                        [matrixUserId]: 100,
                    },
                    users_default: 0,
                    events_default: 0,
                    state_default: 50,
                    ban: 50,
                    kick: 50,
                    redact: 50,
                    invite: 50,
                },
            });
            setSelectedSharedRoomId(result.room_id);
            setActiveRoomId(result.room_id);
            setActiveTab("chat");
            setMobileView("detail");
        } catch (error) {
            setContactRoomActionError(error instanceof Error ? error.message : t("layout.sharedRoomsCreateFailed"));
        } finally {
            setCreatingContactRoom(false);
        }
    };

    const onRemoveContact = async (): Promise<void> => {
        if (!actionToken || !activeContact) return;
        try {
            const { removeContact } = await import("../api/contacts");
            await removeContact(actionToken, activeContact.id, actionHsUrl);
            setActiveContact(null);
            setSelectedSharedRoomId(null);
            setShowContactMenu(false);
            setShowRemoveContactConfirm(false);
            setContactsRefreshToken((prev) => prev + 1);
        } catch {
            setShowContactMenu(false);
            setShowRemoveContactConfirm(false);
        }
    };

    const getLocalPart = (value: string | null | undefined): string => {
        if (!value) return "";
        const trimmed = value.startsWith("@") ? value.slice(1) : value;
        return trimmed.split(":")[0] || "";
    };

    const getGenderLabel = (value: string | null): string => {
        if (!value) return t("common.placeholder");
        if (value === "male") return t("profile.gender.male");
        if (value === "female") return t("profile.gender.female");
        return value;
    };

    const getLanguageLabel = (contact: ContactSummary | null): string => {
        if (!contact) return t("common.placeholder");
        const locale = contact.translationLocale || contact.locale;
        if (!locale) return t("common.placeholder");
        const match = translationLanguageOptions.find((option) => option.value === locale);
        return match?.label ?? locale;
    };

    return (
        <div className="flex-1 min-h-0 overflow-hidden gt-visible-scrollbar flex flex-col bg-white dark:bg-slate-900">
            {activeContact ? (
                <div className="flex-1 min-h-0 flex flex-col">
                    <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-slate-800 sm:px-8 sm:py-6">
                        <div className="flex items-center gap-3 sm:gap-4">
                            <button
                                type="button"
                                onClick={returnToMobileList}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                                aria-label={t("layout.backToList")}
                            >
                                &lt;
                            </button>
                            {(() => {
                                const contactAvatarUrl = getContactAvatarUrl(activeContact.matrixUserId);
                                if (contactAvatarUrl) {
                                    return (
                                        <img
                                            src={contactAvatarUrl}
                                            alt={getContactLabel(activeContact)}
                                            className="w-16 h-16 rounded-full object-cover"
                                        />
                                    );
                                }
                                return (
                                    <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-semibold dark:bg-emerald-900/40 dark:text-emerald-200">
                                        {getContactLabel(activeContact).charAt(0).toUpperCase()}
                                    </div>
                                );
                            })()}
                            <div>
                                <div className="text-xl font-semibold text-slate-800 dark:text-slate-100">
                                    {getContactLabel(activeContact)}
                                </div>
                                <div className="text-sm text-slate-500 dark:text-slate-400">
                                    {activeContact.companyName || t("common.placeholder")}
                                </div>
                            </div>
                        </div>
                        <div className="relative">
                            <button
                                ref={contactMenuButtonRef}
                                type="button"
                                onClick={() => setShowContactMenu((prev) => !prev)}
                                className="h-10 w-10 rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                aria-label={t("layout.contactActions")}
                            >
                                ...
                            </button>
                            {showContactMenu && (
                                <div
                                    ref={contactMenuRef}
                                    className="absolute right-0 mt-2 w-40 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-slate-800 dark:bg-slate-900"
                                >
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowContactMenu(false);
                                            setShowRemoveContactConfirm(true);
                                        }}
                                        className="w-full px-3 py-2 text-left text-rose-500 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-slate-800"
                                    >
                                        {t("layout.removeContact")}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    {showRemoveContactConfirm && (
                        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
                            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                                <div className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
                                    {t("layout.removeContactConfirm")}
                                </div>
                                <div className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                                    {getContactLabel(activeContact)}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowRemoveContactConfirm(false)}
                                        className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    >
                                        {t("common.cancel")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void onRemoveContact()}
                                        className="flex-1 rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-600"
                                    >
                                        {t("common.confirm")}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex-1 px-6 py-4 sm:px-8">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                <div className="flex items-center gap-2">
                                    <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                        {t("layout.details.id")}
                                    </div>
                                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                        {activeContact.userLocalId || getLocalPart(activeContact.matrixUserId) || t("common.placeholder")}
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                <div className="flex items-center gap-2">
                                    <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                        {t("layout.details.name")}
                                    </div>
                                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                        {activeContact.displayName || t("common.placeholder")}
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                <div className="flex items-center gap-2">
                                    <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                        {t("layout.details.gender")}
                                    </div>
                                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                        {getGenderLabel(activeContact.gender)}
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                <div className="flex items-center gap-2">
                                    <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                        {t("layout.details.country")}
                                    </div>
                                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                        {activeContact.country || t("common.placeholder")}
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                                <div className="flex items-center gap-2">
                                    <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                        {t("layout.details.language")}
                                    </div>
                                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                        {getLanguageLabel(activeContact)}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                {t("layout.sharedRoomsTitle")}
                            </div>
                            <div className="mt-2 space-y-1.5">
                                {sharedRoomsWithActiveContact.length > 0 ? (
                                    sharedRoomsWithActiveContact.map((room) => {
                                        const selected = room.roomId === selectedSharedRoomId;
                                        return (
                                            <button
                                                key={room.roomId}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedSharedRoomId(room.roomId);
                                                    setContactRoomActionError(null);
                                                }}
                                                className={`w-full rounded-lg border px-3 py-1.5 text-left transition ${selected
                                                    ? "border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-900/30 dark:text-emerald-100"
                                                    : "border-gray-200 bg-white text-slate-700 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                                    }`}
                                            >
                                                <div className="text-sm font-semibold leading-5">{`${room.displayName} (${room.memberCount})`}</div>
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                        {t("layout.sharedRoomsEmpty")}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="sticky bottom-0 px-6 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-8 lg:static lg:pt-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-gray-100 dark:border-slate-800 lg:border-t-0">
                        {contactRoomActionError ? (
                            <div className="mb-2 text-xs text-rose-500 dark:text-rose-300">{contactRoomActionError}</div>
                        ) : null}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => void onStartChatFromContactDetail()}
                                disabled={!selectedSharedRoomId}
                                className="inline-flex items-center justify-center rounded-xl bg-[#2F5C56] px-6 py-3 text-sm font-semibold text-white shadow-md enabled:hover:bg-[#244a45] disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-emerald-500 dark:enabled:hover:bg-emerald-400 dark:disabled:bg-slate-700"
                            >
                                {t("layout.chatAction")}
                            </button>
                            <button
                                type="button"
                                onClick={() => void onCreateContactRoom()}
                                disabled={creatingContactRoom}
                                className="inline-flex items-center justify-center rounded-xl border border-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-700 enabled:hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-400 dark:text-emerald-300 dark:enabled:hover:bg-emerald-900/20"
                            >
                                {creatingContactRoom ? t("layout.creatingRoomAction") : t("layout.createRoomAction")}
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                    {t("layout.selectContact")}
                </div>
            )}
        </div>
    );
};

export default ContactsPanel;
