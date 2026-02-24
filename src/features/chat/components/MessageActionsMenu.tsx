import { useTranslation } from "react-i18next";

type MessageActionsMenuProps = {
    canToggleTranslation: boolean;
    translationLoading?: boolean;
    showTranslated?: boolean;
    canAssistFromContext: boolean;
    canSendFileToNotebook: boolean;
    canRecallMessage?: boolean;
    sendFileToNotebookBusy?: boolean;
    onToggleTranslation: () => void;
    onCopyMessage: () => void;
    onAssistFromContext?: () => void;
    onSendFileToNotebook?: () => void;
    onRecallMessage?: () => void;
};

export function MessageActionsMenu({
    canToggleTranslation,
    translationLoading,
    showTranslated,
    canAssistFromContext,
    canSendFileToNotebook,
    canRecallMessage,
    sendFileToNotebookBusy,
    onToggleTranslation,
    onCopyMessage,
    onAssistFromContext,
    onSendFileToNotebook,
    onRecallMessage,
}: MessageActionsMenuProps) {
    const { t } = useTranslation();
    return (
        <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {canToggleTranslation && (
                <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={onToggleTranslation}
                    disabled={translationLoading}
                >
                    {translationLoading
                        ? t("chat.translationPending")
                        : showTranslated
                            ? t("chat.showOriginal")
                            : t("chat.showTranslation")}
                </button>
            )}
            <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={onCopyMessage}
            >
                {t("chat.copyMessage")}
            </button>
            {canAssistFromContext && (
                <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                    onClick={onAssistFromContext}
                >
                    {t("chat.notebook.useKnowledgeBase")}
                </button>
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
