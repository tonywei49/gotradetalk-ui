import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ChatSearchError,
    type ChatSearchGlobalResponse,
    type ChatSearchMessageHit,
    type ChatSearchPersonHit,
} from "../features/chat/chatSearchApi";
import type { MatrixClient } from "matrix-js-sdk";

const CHAT_GLOBAL_SEARCH_DEBOUNCE_MS = 350;

function formatMatrixUserLocalId(matrixUserId: string | null | undefined): string {
    const raw = String(matrixUserId || "").trim();
    if (!raw) return "";
    const withoutPrefix = raw.startsWith("@") ? raw.slice(1) : raw;
    const colonIndex = withoutPrefix.indexOf(":");
    return colonIndex > 0 ? withoutPrefix.slice(0, colonIndex) : withoutPrefix;
}

type ChatSearchBarProps = {
    hubAccessToken: string | null;
    matrixAccessToken: string | null;
    matrixHsUrl: string | null;
    matrixCredentials: { user_id?: string; access_token?: string; hs_url?: string } | null;
    matrixClient: MatrixClient | null;
    runHubSessionRequest: <T>(fn: (accessToken: string) => Promise<T>) => Promise<T>;
    setActiveTab: (tab: string) => void;
    setActiveRoomId: (roomId: string) => void;
    setMobileView: (view: "list" | "detail") => void;
    setJumpToEventId: (eventId: string | null) => void;
    activeTab: string;
    setShowCreateRoomModal: (show: boolean) => void;
};

export const ChatSearchBar: React.FC<ChatSearchBarProps> = ({
    hubAccessToken,
    matrixAccessToken,
    matrixHsUrl,
    matrixCredentials,
    matrixClient,
    runHubSessionRequest,
    setActiveTab,
    setActiveRoomId,
    setMobileView,
    setJumpToEventId,
    activeTab,
    setShowCreateRoomModal,
}) => {
    const { t } = useTranslation();
    const [chatGlobalSearchQuery, setChatGlobalSearchQuery] = useState("");
    const [debouncedChatGlobalSearchQuery, setDebouncedChatGlobalSearchQuery] = useState("");
    const [chatGlobalSearchOpen, setChatGlobalSearchOpen] = useState(false);
    const [chatGlobalSearchLoading, setChatGlobalSearchLoading] = useState(false);
    const [chatGlobalSearchError, setChatGlobalSearchError] = useState<string | null>(null);
    const [chatGlobalSearchResult, setChatGlobalSearchResult] = useState<ChatSearchGlobalResponse | null>(null);
    const [chatGlobalSearchCursor, setChatGlobalSearchCursor] = useState<string | null>(null);
    const chatGlobalSearchPanelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedChatGlobalSearchQuery(chatGlobalSearchQuery.trim());
        }, CHAT_GLOBAL_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [chatGlobalSearchQuery]);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent): void => {
            const target = event.target as Node;
            if (chatGlobalSearchPanelRef.current?.contains(target)) return;
            setChatGlobalSearchOpen(false);
        };
        if (chatGlobalSearchOpen) {
            document.addEventListener("click", onClickOutside);
        }
        return () => {
            document.removeEventListener("click", onClickOutside);
        };
    }, [chatGlobalSearchOpen]);

    const runChatGlobalSearch = useCallback(async (params?: { forceQuery?: string; cursor?: string; append?: boolean }) => {
        const q = (params?.forceQuery ?? debouncedChatGlobalSearchQuery).trim();
        if (!q) {
            setChatGlobalSearchResult(null);
            setChatGlobalSearchCursor(null);
            setChatGlobalSearchError(null);
            return;
        }
        if (!hubAccessToken || !matrixAccessToken || !matrixHsUrl || !matrixCredentials?.user_id) {
            setChatGlobalSearchError("NO_VALID_HUB_TOKEN：請重新登入後再使用聊天搜尋");
            return;
        }
        setChatGlobalSearchLoading(true);
        setChatGlobalSearchError(null);
        try {
            const { chatSearchGlobal } = await import("../features/chat/chatSearchApi");
            const response = await runHubSessionRequest((accessToken) => chatSearchGlobal({
                accessToken,
                matrixAccessToken,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials.user_id!,
            }, {
                q,
                limit: 20,
                cursor: params?.cursor,
            }));
            if (params?.append) {
                setChatGlobalSearchResult((prev) => {
                    if (!prev) return response;
                    return {
                        people_hits: [...prev.people_hits, ...response.people_hits],
                        room_hits: [...prev.room_hits, ...response.room_hits],
                        message_hits: [...prev.message_hits, ...response.message_hits],
                        next_cursor: response.next_cursor,
                    };
                });
            } else {
                setChatGlobalSearchResult(response);
            }
            setChatGlobalSearchCursor(response.next_cursor ?? null);
        } catch (error) {
            if (error instanceof ChatSearchError) {
                if (error.status === 401) {
                    setChatGlobalSearchError("401：聊天搜尋驗證失敗，請重新登入");
                } else if (error.status === 403) {
                    setChatGlobalSearchError("403：目前無權限使用聊天搜尋");
                } else {
                    setChatGlobalSearchError(error.message || "聊天搜尋失敗");
                }
            } else {
                setChatGlobalSearchError(error instanceof Error ? error.message : "聊天搜尋失敗");
            }
        } finally {
            setChatGlobalSearchLoading(false);
        }
    }, [debouncedChatGlobalSearchQuery, hubAccessToken, matrixAccessToken, matrixCredentials?.user_id, matrixHsUrl, runHubSessionRequest]);

    useEffect(() => {
        if (!chatGlobalSearchOpen) return;
        if (!debouncedChatGlobalSearchQuery) return;
        void runChatGlobalSearch();
    }, [chatGlobalSearchOpen, debouncedChatGlobalSearchQuery, runChatGlobalSearch]);

    const openRoomWithOptionalJump = useCallback((roomId: string, eventId?: string | null) => {
        setActiveTab("chat");
        setActiveRoomId(roomId);
        setMobileView("detail");
        setChatGlobalSearchOpen(false);
        if (eventId) setJumpToEventId(eventId);
    }, [setActiveRoomId, setActiveTab, setJumpToEventId, setMobileView]);

    const onSelectSearchPerson = useCallback(async (hit: ChatSearchPersonHit) => {
        if (!matrixClient || !hit.matrix_user_id) {
            setChatGlobalSearchError("無法定位該使用者聊天室");
            return;
        }
        try {
            const { getOrCreateDirectRoom } = await import("../matrix/direct");
            const roomId = await getOrCreateDirectRoom(matrixClient, hit.matrix_user_id);
            openRoomWithOptionalJump(roomId);
        } catch (error) {
            setChatGlobalSearchError(error instanceof Error ? error.message : "無法打開聊天室");
        }
    }, [matrixClient, openRoomWithOptionalJump]);

    const onSelectSearchMessage = useCallback((hit: ChatSearchMessageHit) => {
        openRoomWithOptionalJump(hit.room_id, hit.event_id);
    }, [openRoomWithOptionalJump]);

    return (
        <div ref={chatGlobalSearchPanelRef} className="relative p-3">
            <div className="bg-gray-100 rounded-lg px-3 py-2 flex items-center gap-2 dark:bg-slate-800">
                <svg
                    className="w-5 h-5 text-gray-400 dark:text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                </svg>
                <input
                    type="text"
                    value={chatGlobalSearchQuery}
                    onFocus={() => setChatGlobalSearchOpen(true)}
                    onChange={(event) => {
                        setChatGlobalSearchQuery(event.target.value);
                        setChatGlobalSearchOpen(true);
                        if (!event.target.value.trim()) {
                            setChatGlobalSearchResult(null);
                            setChatGlobalSearchCursor(null);
                            setChatGlobalSearchError(null);
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            void runChatGlobalSearch({ forceQuery: chatGlobalSearchQuery });
                        }
                        if (event.key === "Escape") {
                            setChatGlobalSearchOpen(false);
                        }
                    }}
                    placeholder={t("layout.searchPlaceholder")}
                    className="bg-transparent border-none outline-none text-sm w-full text-slate-700 placeholder-gray-400 dark:text-slate-200 dark:placeholder-slate-500"
                />
                {activeTab === "chat" && (
                    <button
                        type="button"
                        onClick={() => setShowCreateRoomModal(true)}
                        className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-300"
                    >
                        {t("layout.createRoomLabel", t("layout.groupChat", "New room"))}
                    </button>
                )}
            </div>
            {chatGlobalSearchOpen && (
                <div className="absolute left-3 right-3 top-[58px] z-30 max-h-[55vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    {chatGlobalSearchLoading && (
                        <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-300">搜尋中...</div>
                    )}
                    {chatGlobalSearchError && (
                        <div className="px-3 py-3 text-xs text-rose-600 dark:text-rose-300">{chatGlobalSearchError}</div>
                    )}
                    {!chatGlobalSearchLoading && !chatGlobalSearchError && chatGlobalSearchQuery.trim() && (
                        <>
                            {chatGlobalSearchResult?.people_hits?.length ? (
                                <div className="border-b border-gray-100 px-3 py-2 dark:border-slate-800">
                                    <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">人員</div>
                                    <div className="space-y-1">
                                        {chatGlobalSearchResult.people_hits.map((hit) => (
                                            <button
                                                key={`${hit.profile_id}-${hit.matrix_user_id || ""}`}
                                                type="button"
                                                onClick={() => {
                                                    void onSelectSearchPerson(hit);
                                                }}
                                                className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                                            >
                                                <div className="font-semibold text-slate-700 dark:text-slate-100">{hit.display_name || hit.user_local_id || hit.matrix_user_id || "Unknown"}</div>
                                                <div className="text-slate-500 dark:text-slate-400">
                                                    {formatMatrixUserLocalId(hit.matrix_user_id) || hit.company_name || ""}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                            {chatGlobalSearchResult?.message_hits?.length ? (
                                <div className="px-3 py-2">
                                    <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">消息</div>
                                    <div className="space-y-1">
                                        {chatGlobalSearchResult.message_hits.map((hit) => (
                                            <button
                                                key={`${hit.room_id}-${hit.event_id}`}
                                                type="button"
                                                onClick={() => onSelectSearchMessage(hit)}
                                                className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                                            >
                                                <div className="line-clamp-2 font-semibold text-slate-700 dark:text-slate-100">{hit.preview || "(no preview)"}</div>
                                                <div className="text-slate-500 dark:text-slate-400">
                                                    {`${formatMatrixUserLocalId(hit.sender) || ""}${hit.ts ? ` · ${new Date(hit.ts).toLocaleString()}` : ""}`}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                            {!chatGlobalSearchResult?.people_hits?.length && !chatGlobalSearchResult?.message_hits?.length && (
                                <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-300">沒有搜尋結果</div>
                            )}
                            {chatGlobalSearchCursor && (
                                <div className="border-t border-gray-100 px-3 py-2 dark:border-slate-800">
                                    <button
                                        type="button"
                                        onClick={() => void runChatGlobalSearch({ forceQuery: chatGlobalSearchQuery, cursor: chatGlobalSearchCursor, append: true })}
                                        disabled={chatGlobalSearchLoading}
                                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200"
                                    >
                                        載入更多
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
