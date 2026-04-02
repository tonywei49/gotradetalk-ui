import type { TranslationDisplayMode } from "../hooks/useMessageTranslation";
import { useTranslation } from "react-i18next";

type MessageActionsMenuProps = {
    canToggleTranslation: boolean;
    translationLoading?: boolean;
    translationMode?: TranslationDisplayMode;
    canRetryTranslation?: boolean;
    canQuoteMessage?: boolean;
    showAssistFromContext?: boolean;
    canAssistFromContext: boolean;
    assistFromContextReason?: string | null;
    canSendFileToNotebook: boolean;
    canRecallMessage?: boolean;
    sendFileToNotebookBusy?: boolean;
    onSetTranslationMode: (mode: TranslationDisplayMode) => void;
    onRetryTranslation?: () => void;
    onCopyMessage: () => void;
    onQuoteMessage?: () => void;
    onAssistFromContext?: () => void;
    onAssistFromContextUnavailable?: () => void;
    onSendFileToNotebook?: () => void;
    onRecallMessage?: () => void;
    openUpward?: boolean;
    align?: "left" | "right";
};

export function MessageActionsMenu({
    canToggleTranslation,
    translationLoading,
    translationMode,
    canRetryTranslation,
    canQuoteMessage,
    showAssistFromContext = false,
    canAssistFromContext,
    assistFromContextReason,
    canSendFileToNotebook,
    canRecallMessage,
    sendFileToNotebookBusy,
    onSetTranslationMode,
    onRetryTranslation,
    onCopyMessage,
    onQuoteMessage,
    onAssistFromContext,
    onAssistFromContextUnavailable,
    onSendFileToNotebook,
    onRecallMessage,
    openUpward = false,
    align = "right",
}: MessageActionsMenuProps) {
    const { t } = useTranslation();
    const showSwitchToOriginal = translationMode === "translated" || translationMode === "bilingual";
    const showSwitchToTranslated = translationMode === "original" || translationMode === "bilingual";
    const showBilingualOption = translationMode !== "bilingual";

    return (
        <div
            className={`absolute z-20 w-40 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
                align === "left" ? "left-0" : "right-0"
            } ${openUpward ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
            {canToggleTranslation && (
                <>
                    {showSwitchToOriginal && (
                        <button
                            type="button"
                            className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                            onClick={() => onSetTranslationMode("original")}
                            disabled={translationLoading}
                        >
                            {t("chat.showOriginal")}
                        </button>
                    )}
                    {showSwitchToTranslated && (
                        <button
                            type="button"
                            className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                            onClick={() => onSetTranslationMode("translated")}
                            disabled={translationLoading}
                        >
                            {translationLoading ? t("chat.translationPending") : t("chat.showTranslation")}
                        </button>
                    )}
                    {showBilingualOption && (
                        <button
                            type="button"
                            className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                            onClick={() => onSetTranslationMode("bilingual")}
                        >
                            {t("chat.showBilingual")}
                        </button>
                    )}
                    {canRetryTranslation && (
                        <button
                            type="button"
                            className="w-full px-3 py-1.5 text-left text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/20"
                            onClick={onRetryTranslation}
                            disabled={translationLoading}
                        >
                            {t("chat.retryTranslation")}
                        </button>
                    )}
                </>
            )}
            <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={onCopyMessage}
            >
                {t("chat.copyMessage")}
            </button>
            {canQuoteMessage && (
                <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={onQuoteMessage}
                >
                    {t("chat.quoteMessage")}
                </button>
            )}
            {showAssistFromContext && (
                <>
                    <button
                        type="button"
                        className={`w-full px-3 py-1.5 text-left ${
                            canAssistFromContext
                                ? "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                                : "text-slate-400 hover:bg-slate-50 dark:text-slate-500 dark:hover:bg-slate-800"
                        }`}
                        onClick={canAssistFromContext ? onAssistFromContext : onAssistFromContextUnavailable}
                        title={!canAssistFromContext ? assistFromContextReason ?? undefined : undefined}
                    >
                        {t("chat.notebook.useKnowledgeBase")}
                    </button>
                    {!canAssistFromContext && assistFromContextReason && (
                        <div className="px-3 pb-1 text-[10px] leading-4 text-slate-400 dark:text-slate-500">
                            {assistFromContextReason}
                        </div>
                    )}
                </>
            )}
            {canSendFileToNotebook && (
                <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                    onClick={onSendFileToNotebook}
                    disabled={sendFileToNotebookBusy}
                >
                    {sendFileToNotebookBusy
                        ? t("chat.notebook.sendingToKnowledgeBase")
                        : t("chat.notebook.sendFileToKnowledgeBase")}
                </button>
            )}
            {canRecallMessage && (
                <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-rose-500 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-slate-800"
                    onClick={onRecallMessage}
                >
                    {t("chat.recallMessage")}
                </button>
            )}
        </div>
    );
}
