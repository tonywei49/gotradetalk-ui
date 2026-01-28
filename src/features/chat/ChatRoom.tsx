import React from "react";
import {
    MagnifyingGlassIcon,
    LanguageIcon,
    EllipsisVerticalIcon,
    FaceSmileIcon,
    PaperClipIcon,
    MicrophoneIcon,
} from "@heroicons/react/24/outline";
import { PaperAirplaneIcon } from "@heroicons/react/24/solid";

// Mock Message Data
type MockMessage = {
    id: number;
    sender: string;
    text: string;
    time: string;
    isMe: boolean;
    read?: boolean;
};

const MOCK_MESSAGES: MockMessage[] = [
    { id: 1, sender: "Alice", text: "Hi Tony, have you reviewed the contract?", time: "10:30 AM", isMe: false },
    { id: 2, sender: "Me", text: "Yes, I just finished reading it.", time: "10:32 AM", isMe: true, read: true },
    {
        id: 3,
        sender: "Me",
        text: "Everything looks good. I will sign it shortly.",
        time: "10:32 AM",
        isMe: true,
        read: true,
    },
    { id: 4, sender: "Alice", text: "Great! Let me know when you send it.", time: "10:35 AM", isMe: false },
    {
        id: 5,
        sender: "Alice",
        text: "Also, do we need to schedule a call for the next phase?",
        time: "10:36 AM",
        isMe: false,
    },
];

const MessageBubble = ({ msg }: { msg: MockMessage }) => {
    return (
        <div className={`flex w-full mb-4 ${msg.isMe ? "justify-end" : "justify-start"}`}>
            {/* Avatar (Incoming only) */}
            {!msg.isMe && (
                <div className="w-10 h-10 rounded-full bg-gray-300 mr-3 flex-shrink-0 self-start mt-1" />
            )}

            <div className={`flex flex-col max-w-[70%] ${msg.isMe ? "items-end" : "items-start"}`}>
                {/* Sender Name (Incoming only) */}
                {!msg.isMe && (
                    <span className="text-xs text-gray-500 mb-1 ml-1 dark:text-slate-400">{msg.sender}</span>
                )}

                <div className="flex items-end gap-2">
                    {/* Read Status & Time (Outgoing: Left of bubble) */}
                    {msg.isMe && (
                        <div className="flex flex-col items-end justify-end text-[10px] text-gray-400 min-w-[40px] mb-1">
                        {msg.read && <span className="text-[#2F5C56] font-medium dark:text-emerald-400">Read</span>}
                        <span className="text-gray-400 dark:text-slate-500">{msg.time}</span>
                        </div>
                    )}

                    {/* Bubble */}
                    <div
                        className={`
              px-4 py-3 text-sm leading-relaxed shadow-sm relative
              ${
                  msg.isMe
                      ? "bg-[#2F5C56] text-white rounded-2xl rounded-tr-sm"
                        : "bg-white text-slate-800 rounded-2xl rounded-tl-sm border border-gray-100 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700"
              }
            `}
                    >
                        {msg.text}
                    </div>

                    {/* Time (Incoming: Right of bubble) */}
                    {!msg.isMe && (
                        <span className="text-[10px] text-gray-400 self-end mb-1 dark:text-slate-500">{msg.time}</span>
                    )}
                </div>
            </div>
        </div>
    );
};

export const ChatRoom: React.FC = () => {
    return (
        <div className="flex flex-col h-full w-full">
            {/* 4. Header */}
            <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0 shadow-sm z-10 dark:bg-slate-900 dark:border-slate-800">
                <div className="flex flex-col">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Alice Chen</h2>
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
            <div className="flex-1 overflow-y-auto p-6 bg-[#F2F4F7] dark:bg-slate-950">
                {/* Date Separator */}
                <div className="flex justify-center mb-6">
                    <span className="bg-gray-200 text-gray-500 text-xs px-3 py-1 rounded-full dark:bg-slate-800 dark:text-slate-400">
                        Today
                    </span>
                </div>

                {MOCK_MESSAGES.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} />
                ))}
            </div>

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
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:border-[#2F5C56] focus:ring-1 focus:ring-[#2F5C56] resize-none h-12 max-h-32 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:focus:border-emerald-400 dark:focus:ring-emerald-400"
                        placeholder="Type a message..."
                        rows={1}
                    />
                    <button className="bg-[#2F5C56] hover:bg-[#244a45] text-white p-3 rounded-xl shadow-md transition-colors flex items-center justify-center dark:bg-emerald-500 dark:hover:bg-emerald-400">
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};
