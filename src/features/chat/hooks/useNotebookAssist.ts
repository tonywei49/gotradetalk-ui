import { useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import type { NotebookAdapter } from "../../notebook/adapters/types";
import type { NotebookAssistResponse, NotebookAuthContext } from "../../notebook/types";
import { NOTEBOOK_ASSIST_CONTEXT_WINDOW_SIZE } from "../../notebook/constants";
import { mapNotebookErrorToMessage } from "../../notebook/notebookErrorMap";

type UseNotebookAssistParams = {
    adapter: NotebookAdapter;
    notebookAuth: NotebookAuthContext | null;
    activeRoomId: string | null;
    canUseNotebookAssist: boolean;
    responseLang?: string | null;
    knowledgeScope?: "personal" | "company" | "both";
    t: TFunction;
};

type AssistTrigger =
    | { type: "query"; query: string }
    | { type: "context"; anchorEventId: string; windowSize: number };

export function useNotebookAssist(params: UseNotebookAssistParams) {
    const [assistState, setAssistState] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [assistError, setAssistError] = useState<string | null>(null);
    const [assistOutput, setAssistOutput] = useState<NotebookAssistResponse | null>(null);
    const [assistDraft, setAssistDraft] = useState("");
    const [assistCitationsExpanded, setAssistCitationsExpanded] = useState(false);
    const [lastAssistTrigger, setLastAssistTrigger] = useState<AssistTrigger | null>(null);

    const applyAssistOutput = useCallback((result: NotebookAssistResponse): void => {
        setAssistOutput(result);
        setAssistDraft(result.answer);
        setAssistState("success");
        setAssistError(null);
    }, []);

    const ensureKnowledgeBaseAvailable = useCallback(async (): Promise<boolean> => {
        if (!params.notebookAuth) return false;
        const list = await params.adapter.listItems(params.notebookAuth, {
            filter: "knowledge",
            scope: params.knowledgeScope || "both",
        });
        return list.length > 0;
    }, [params.adapter, params.notebookAuth, params.knowledgeScope]);

    const runAssistQuery = useCallback(async (query: string): Promise<void> => {
        if (!params.canUseNotebookAssist || !params.notebookAuth || !params.activeRoomId) return;
        const trimmed = query.trim();
        if (!trimmed) {
            setAssistState("error");
            setAssistError(params.t("chat.notebook.errors.emptyQuery"));
            return;
        }
        setAssistState("loading");
        setAssistError(null);
        try {
            const hasKnowledgeBase = await ensureKnowledgeBaseAvailable();
            if (!hasKnowledgeBase) {
                setAssistState("error");
                setAssistError(params.t("chat.notebook.errors.noKnowledgeBaseItems"));
                return;
            }
            const result = await params.adapter.assistQuery(params.notebookAuth, {
                roomId: params.activeRoomId,
                query: trimmed,
                knowledgeScope: params.knowledgeScope || "both",
                responseLang: (params.responseLang || "").trim() || "zh-TW",
            });
            applyAssistOutput(result);
            setLastAssistTrigger({ type: "query", query: trimmed });
        } catch (error) {
            setAssistState("error");
            setAssistError(mapNotebookErrorToMessage(error, params.t));
        }
    }, [params, applyAssistOutput, ensureKnowledgeBaseAvailable]);

    const runAssistFromContext = useCallback(async (anchorEventId: string): Promise<void> => {
        if (!params.canUseNotebookAssist || !params.notebookAuth || !params.activeRoomId) return;
        setAssistState("loading");
        setAssistError(null);
        try {
            const hasKnowledgeBase = await ensureKnowledgeBaseAvailable();
            if (!hasKnowledgeBase) {
                setAssistState("error");
                setAssistError(params.t("chat.notebook.errors.noKnowledgeBaseItems"));
                return;
            }
            const result = await params.adapter.assistFromContext(params.notebookAuth, {
                roomId: params.activeRoomId,
                anchorEventId,
                windowSize: NOTEBOOK_ASSIST_CONTEXT_WINDOW_SIZE,
                knowledgeScope: params.knowledgeScope || "both",
                responseLang: (params.responseLang || "").trim() || "zh-TW",
            });
            applyAssistOutput(result);
            setLastAssistTrigger({ type: "context", anchorEventId, windowSize: NOTEBOOK_ASSIST_CONTEXT_WINDOW_SIZE });
        } catch (error) {
            setAssistState("error");
            setAssistError(mapNotebookErrorToMessage(error, params.t));
        }
    }, [params, applyAssistOutput, ensureKnowledgeBaseAvailable]);

    const resetAssist = useCallback(() => {
        setAssistState("idle");
        setAssistError(null);
        setAssistOutput(null);
        setAssistDraft("");
        setAssistCitationsExpanded(false);
    }, []);

    const assistLowConfidence = useMemo(() => (assistOutput?.confidence ?? 1) < 0.6, [assistOutput?.confidence]);

    return {
        assistState,
        assistError,
        assistOutput,
        assistDraft,
        setAssistDraft,
        assistCitationsExpanded,
        setAssistCitationsExpanded,
        lastAssistTrigger,
        setLastAssistTrigger,
        assistLowConfidence,
        runAssistQuery,
        runAssistFromContext,
        resetAssist,
    };
}
