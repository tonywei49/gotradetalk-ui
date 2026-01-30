import React, { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    MagnifyingGlassIcon,
    LanguageIcon,
    EllipsisVerticalIcon,
    FaceSmileIcon,
    PaperClipIcon,
    MicrophoneIcon,
} from "@heroicons/react/24/outline";
import { PaperAirplaneIcon, ChevronDownIcon } from "@heroicons/react/24/solid";
import type { MatrixEvent } from "matrix-js-sdk";
import { EventStatus, EventType, MsgType } from "matrix-js-sdk";
import { useAuthStore } from "../../stores/AuthStore";
import { useRoomTimeline } from "../../matrix/hooks/useRoomTimeline";

type MessageBubbleProps = {
    event: MatrixEvent;
    isMe: boolean;
    status: EventStatus | null;
    onResend: (event: MatrixEvent) => void;
    mediaUrl: string | null;
    senderLabel: string;
};

const MessageBubble = ({ event, isMe, status, onResend, mediaUrl, senderLabel }: MessageBubbleProps) => {
    const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
    const messageText = content?.body ?? "";
    const isSending =
        status === EventStatus.SENDING || status === EventStatus.ENCRYPTING || status === EventStatus.QUEUED;
    const isFailed = status === EventStatus.NOT_SENT;
    const timeLabel = new Date(event.getTs()).toLocaleTimeString();

    return (
        <div className={`flex w-full mb-3 ${isMe ? "justify-end" : "justify-start"} ${isSending ? "opacity-60" : ""}`}>
            {/* Avatar (Incoming only) */}
            {!isMe && <div className="w-8 h-8 rounded-full bg-gray-300 mr-3 flex-shrink-0 self-start mt-1" />}

            <div className={`flex flex-col max-w-[70%] ${isMe ? "items-end" : "items-start"}`}>
                {/* Sender Name (Incoming only) */}
                {!isMe && (
                    <span className="text-[11px] text-gray-500 mb-1 ml-1 dark:text-slate-400">{senderLabel}</span>
                )}

                <div className="flex items-end gap-2">
                    {/* Read Status & Time (Outgoing: Left of bubble) */}
                    {isMe && (
                        <div className="flex flex-col items-end justify-end text-[9px] text-gray-400 min-w-[56px] mb-1">
                            {isFailed && <span className="text-rose-500 font-medium">Failed</span>}
                            <span className="text-gray-400 dark:text-slate-500">{timeLabel}</span>
                        </div>
                    )}

                    {/* Bubble */}
                    <div
                        className={`
              px-3 py-2 text-[13px] leading-relaxed shadow-sm relative
              ${isMe
                                ? "bg-[#2F5C56] text-white rounded-2xl rounded-tr-sm"
                                : "bg-white text-slate-800 rounded-2xl rounded-tl-sm border border-gray-100 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700"
                            }
            `}
                    >
                        {content?.msgtype === MsgType.Image && mediaUrl ? (
                            <img src={mediaUrl} alt={messageText || "image"} className="max-w-[280px] rounded-lg" />
                        ) : (
                            messageText
                        )}
                    </div>

                    {/* Time (Incoming: Right of bubble) */}
                    {!isMe && (
                        <span className="text-[9px] text-gray-400 self-end mb-1 dark:text-slate-500">{timeLabel}</span>
                    )}
                </div>
                {isFailed && (
                    <button
                        type="button"
                        className="mt-2 text-[11px] text-rose-500 hover:text-rose-400"
                        onClick={() => onResend(event)}
                    >
                        Resend
                    </button>
                )}
            </div>
        </div>
    );
};

type ChatRoomContext = {
    activeRoomId: string | null;
};

export const ChatRoom: React.FC = () => {
    const { activeRoomId } = useOutletContext<ChatRoomContext>();
    const matrixClient = useAuthStore((state) => state.matrixClient);
    const userId = useAuthStore((state) => state.matrixCredentials?.user_id ?? null);
    const { events, room } = useRoomTimeline(matrixClient, activeRoomId, { limit: 200 });
    const timelineRef = useRef<HTMLDivElement | null>(null);
    const [composerText, setComposerText] = useState("");
    const [scrollLoading, setScrollLoading] = useState(false);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
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
        return localpart || displayName || userId || "Unknown";
    };

    const mergedEvents = useMemo(() => {
        if (!room) return [];
        const combined = [...events];
        const seen = new Set<string>();
        const filtered = combined.filter((event) => {
            if (event.getType() !== EventType.RoomMessage) return false;
            const key = event.getId() ?? event.getTxnId() ?? String(event.getTs());
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        filtered.sort((a, b) => a.getTs() - b.getTs());
        return filtered;
    }, [events, room]);

    // 自動滾動到底部並發送已讀回執
    useEffect(() => {
        if (!room || !matrixClient) return;
        const container = timelineRef.current;
        if (!container) return;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom < 120) {
            container.scrollTop = container.scrollHeight;
            // 在底部時發送已讀回執
            const latestEvent = mergedEvents[mergedEvents.length - 1];
            if (latestEvent) {
                void matrixClient.sendReadReceipt(latestEvent);
            }
        }
    }, [mergedEvents.length, room, matrixClient, mergedEvents]);

    // 進入房間時如果在底部也發送已讀回執
    useEffect(() => {
        if (!matrixClient || !room || !activeRoomId) return;
        // 延遲執行以確保滾動位置已更新
        const timer = setTimeout(() => {
            const container = timelineRef.current;
            if (!container) return;
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            if (distanceFromBottom < 120) {
                const latestEvent = mergedEvents[mergedEvents.length - 1];
                if (latestEvent) {
                    void matrixClient.sendReadReceipt(latestEvent);
                }
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [activeRoomId]); // 只在切換房間時觸發

    if (!activeRoomId) {
        return <div className="flex-1" />;
    }

    if (!room) {
        return (
            <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                Loading chat...
            </div>
        );
    }

    const onScroll = async (): Promise<void> => {
        if (!matrixClient || scrollLoading) return;
        const container = timelineRef.current;
        if (!container) return;

        // 更新滾動到底部按鈕的顯示狀態
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        setShowScrollToBottom(distanceFromBottom > 200);

        // 當滾動到底部時發送已讀回執
        if (distanceFromBottom < 50) {
            const latestEvent = mergedEvents[mergedEvents.length - 1];
            if (latestEvent) {
                void matrixClient.sendReadReceipt(latestEvent);
            }
        }

        // 滾動加載更多消息
        if (container.scrollTop > 0) return;
        setScrollLoading(true);
        try {
            await matrixClient.scrollback(room, 30);
        } finally {
            setScrollLoading(false);
        }
    };

    const scrollToBottom = (): void => {
        const container = timelineRef.current;
        if (container) {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        }
    };

    const onSend = (): void => {
        if (!matrixClient || !activeRoomId) return;
        const trimmed = composerText.trim();
        if (!trimmed) return;
        setComposerText("");
        void matrixClient.sendEvent(activeRoomId, EventType.RoomMessage, {
            msgtype: MsgType.Text,
            body: trimmed,
        });
    };

    const onResend = async (event: MatrixEvent): Promise<void> => {
        if (!matrixClient || !room) return;
        await matrixClient.resendEvent(event, room);
    };

    const otherMember = room
        ? room.getJoinedMembers().find((member) => member.userId !== userId)
        : undefined;
    const headerName = getUserLabel(otherMember?.userId, otherMember?.name) || room.name || "Chat";

    return (
        <div className="flex flex-col h-full w-full">
            {/* 4. Header */}
            <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0 shadow-sm z-10 dark:bg-slate-900 dark:border-slate-800">
                <div className="flex flex-col">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{headerName}</h2>
                    <span className="text-xs text-green-600 flex items-center gap-1 dark:text-emerald-400">
                        <span className="w-2 h-2 bg-green-500 rounded-full dark:bg-emerald-400"></span>
                        Online
                    </span>
                </div>

                <div className="flex items-center gap-4 text-gray-500 dark:text-slate-400">
                    <button className="hover:text-[#2F5C56] transition-colors p-2 rounded-full hover:bg-gray-50 dark:hover:bg-slate-800">
                        <MagnifyingGlassIcon className="w-6 h-6" />
                    </button>
                    <button className="hover:text-[#2F5C56] transition-colors p-2 rounded-full hover:bg-gray-50 dark:hover:bg-slate-800">
                        <LanguageIcon className="w-6 h-6" />
                    </button>
                    <button className="hover:text-[#2F5C56] transition-colors p-2 rounded-full hover:bg-gray-50 dark:hover:bg-slate-800">
                        <EllipsisVerticalIcon className="w-6 h-6" />
                    </button>
                </div>
            </header>

            {/* Chat History (Timeline) */}
            <div
                ref={timelineRef}
                onScroll={() => void onScroll()}
                className="flex-1 overflow-y-auto p-6 bg-[#F2F4F7] dark:bg-slate-950"
            >
                {scrollLoading && (
                    <div className="text-center text-xs text-slate-400 dark:text-slate-500 mb-4">
                        Loading...
                    </div>
                )}
                {mergedEvents.map((event) => {
                    const status = event.getAssociatedStatus?.() ?? event.status ?? null;
                    const isMe = event.getSender() === userId;
                    const content = event.getContent() as { url?: string } | undefined;
                    const mediaUrl =
                        content?.url && matrixClient
                            ? matrixClient.mxcUrlToHttp(content.url, 800, 800, "scale")
                            : null;
                    const sender = event.getSender();
                    const senderMember = sender ? room?.getMember(sender) : null;
                    const senderLabel = getUserLabel(sender, senderMember?.name);
                    return (
                        <MessageBubble
                            key={event.getId() ?? event.getTxnId() ?? `${event.getTs()}-${event.getSender()}`}
                            event={event}
                            isMe={isMe}
                            status={status}
                            mediaUrl={mediaUrl}
                            onResend={onResend}
                            senderLabel={senderLabel}
                        />
                    );
                })}
            </div>

            {/* 滾動到底部按鈕 */}
            {showScrollToBottom && (
                <button
                    type="button"
                    onClick={scrollToBottom}
                    className="absolute bottom-32 right-8 w-10 h-10 bg-white dark:bg-slate-800 rounded-full shadow-lg border border-gray-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors z-20"
                    aria-label="Scroll to bottom"
                >
                    <ChevronDownIcon className="w-5 h-5" />
                </button>
            )}

            {/* Composer */}
            <div className="bg-white border-t border-gray-200 p-4 flex-shrink-0 dark:bg-slate-900 dark:border-slate-800">
                {/* Toolbar */}
                <div className="flex gap-4 mb-2 px-1 text-gray-400 dark:text-slate-500">
                    <button className="hover:text-[#2F5C56] dark:hover:text-emerald-400">
                        <FaceSmileIcon className="w-6 h-6" />
                    </button>
                    <button className="hover:text-[#2F5C56] dark:hover:text-emerald-400">
                        <PaperClipIcon className="w-6 h-6" />
                    </button>
                    <button className="hover:text-[#2F5C56] dark:hover:text-emerald-400">
                        <MicrophoneIcon className="w-6 h-6" />
                    </button>
                </div>

                {/* Input Area */}
                <div className="flex gap-3 items-end">
                    <textarea
                        value={composerText}
                        onChange={(event) => setComposerText(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.ctrlKey) {
                                event.preventDefault();
                                void onSend();
                            }
                        }}
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-[#2F5C56] focus:ring-1 focus:ring-[#2F5C56] resize-none h-12 max-h-32 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:focus:border-emerald-400 dark:focus:ring-emerald-400"
                        placeholder="Type a message..."
                        rows={1}
                    />
                    <button
                        type="button"
                        onClick={() => void onSend()}
                        className="bg-[#2F5C56] hover:bg-[#244a45] text-white p-3 rounded-xl shadow-md transition-colors flex items-center justify-center dark:bg-emerald-500 dark:hover:bg-emerald-400"
                    >
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};
