import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { NotebookAdapter } from "../../notebook/adapters/types";
import type { NotebookAssistResponse, NotebookAuthContext } from "../../notebook/types";
import { NOTEBOOK_ASSIST_CONTEXT_WINDOW_SIZE } from "../../notebook/constants";
import { mapNotebookErrorToMessage } from "../../notebook/notebookErrorMap";
import { isNotebookTerminalAuthFailure } from "../../notebook/utils/isNotebookTerminalAuthFailure";
import { readUiStateFromSqlite, writeUiStateToSqlite } from "../../../desktop/desktopCacheDb";

type UseNotebookAssistParams = {
    adapter: NotebookAdapter;
    notebookAuth: NotebookAuthContext | null;
    activeRoomId: string | null;
    canUseNotebookAssist: boolean;
    responseLang?: string | null;
    knowledgeScope?: "personal" | "company" | "both";
    onTerminalAuthFailure?: (error: unknown) => void;
    t: TFunction;
};

type AssistTrigger =
    | { type: "query"; query: string }
    | { type: "context"; anchorEventId: string; windowSize: number };

type AssistCachePayload = {
    assistState: "idle" | "loading" | "success" | "error";
    assistError: string | null;
    assistOutput: NotebookAssistResponse | null;
    assistDraft: string;
    assistCitationsExpanded: boolean;
    lastAssistTrigger: AssistTrigger | null;
};

const ASSIST_CACHE_KEY_PREFIX = "gtt_chat_notebook_assist_v1";
const ASSIST_CACHE_SCOPE = "chat-notebook-assist";
const ASSIST_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function readAssistCache(storageKey: string): AssistCachePayload | null {
    if (!storageKey || typeof window === "undefined") return null;
    try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<AssistCachePayload>;
        if (!parsed || typeof parsed !== "object") return null;
        return {
            assistState: parsed.assistState === "loading" || parsed.assistState === "success" || parsed.assistState === "error"
                ? parsed.assistState
                : "idle",
            assistError: typeof parsed.assistError === "string" ? parsed.assistError : null,
            assistOutput: parsed.assistOutput ?? null,
            assistDraft: typeof parsed.assistDraft === "string" ? parsed.assistDraft : "",
            assistCitationsExpanded: Boolean(parsed.assistCitationsExpanded),
            lastAssistTrigger: parsed.lastAssistTrigger ?? null,
        };
    } catch {
        return null;
    }
}

function writeAssistCache(storageKey: string, payload: AssistCachePayload): void {
    if (!storageKey || typeof window === "undefined") return;
    const isEmpty = payload.assistState === "idle"
        && !payload.assistError
        && !payload.assistOutput
        && !payload.assistDraft
        && !payload.lastAssistTrigger;
    if (isEmpty) {
        window.sessionStorage.removeItem(storageKey);
        return;
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(payload));
}

export function useNotebookAssist(params: UseNotebookAssistParams) {
    const storageKey = useMemo(
        () => (params.activeRoomId ? `${ASSIST_CACHE_KEY_PREFIX}:${params.activeRoomId}` : ""),
        [params.activeRoomId],
    );
    const sqliteKey = useMemo(
        () => (params.notebookAuth?.matrixUserId && params.activeRoomId ? `${params.notebookAuth.matrixUserId}:${params.activeRoomId}` : null),
        [params.activeRoomId, params.notebookAuth?.matrixUserId],
    );
    const resumeInFlightRef = useRef(false);
    const initialCache = readAssistCache(storageKey);
    const [assistState, setAssistState] = useState<"idle" | "loading" | "success" | "error">(initialCache?.assistState ?? "idle");
    const [assistError, setAssistError] = useState<string | null>(initialCache?.assistError ?? null);
    const [assistOutput, setAssistOutput] = useState<NotebookAssistResponse | null>(initialCache?.assistOutput ?? null);
    const [assistDraft, setAssistDraft] = useState(initialCache?.assistDraft ?? "");
    const [assistCitationsExpanded, setAssistCitationsExpanded] = useState(Boolean(initialCache?.assistCitationsExpanded));
    const [lastAssistTrigger, setLastAssistTrigger] = useState<AssistTrigger | null>(initialCache?.lastAssistTrigger ?? null);
    const hydratedStorageKeyRef = useRef<string>(storageKey);

    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (!storageKey || hydratedStorageKeyRef.current === storageKey) return;
        hydratedStorageKeyRef.current = storageKey;
        resumeInFlightRef.current = false;
        const cached = readAssistCache(storageKey);
        if (!cached) {
            setAssistState("idle");
            setAssistError(null);
            setAssistOutput(null);
            setAssistDraft("");
            setAssistCitationsExpanded(false);
            setLastAssistTrigger(null);
            return;
        }
        setAssistState(cached.assistState);
        setAssistError(cached.assistError);
        setAssistOutput(cached.assistOutput);
        setAssistDraft(cached.assistDraft);
        setAssistCitationsExpanded(cached.assistCitationsExpanded);
        setLastAssistTrigger(cached.lastAssistTrigger);
    }, [storageKey]);
    /* eslint-enable react-hooks/set-state-in-effect */

    useEffect(() => {
        if (!storageKey) return;
        let disposed = false;
        void readUiStateFromSqlite<AssistCachePayload>(ASSIST_CACHE_SCOPE, sqliteKey, ASSIST_CACHE_TTL_MS)
            .then((cached) => {
                if (disposed || !cached) return;
                setAssistState(cached.assistState);
                setAssistError(cached.assistError);
                setAssistOutput(cached.assistOutput);
                setAssistDraft(cached.assistDraft);
                setAssistCitationsExpanded(cached.assistCitationsExpanded);
                setLastAssistTrigger(cached.lastAssistTrigger);
            })
            .catch(() => undefined);
        return () => {
            disposed = true;
        };
    }, [sqliteKey, storageKey]);

    const applyAssistOutput = useCallback((result: NotebookAssistResponse): void => {
        setAssistOutput(result);
        setAssistDraft((result.referenceAnswer || result.answer || result.summaryText || "").trim());
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
            if (isNotebookTerminalAuthFailure(error)) {
                params.onTerminalAuthFailure?.(error);
                setAssistState("idle");
                setAssistError(null);
                return;
            }
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
            if (isNotebookTerminalAuthFailure(error)) {
                params.onTerminalAuthFailure?.(error);
                setAssistState("idle");
                setAssistError(null);
                return;
            }
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

    useEffect(() => {
        const payload = {
            assistState,
            assistError,
            assistOutput,
            assistDraft,
            assistCitationsExpanded,
            lastAssistTrigger,
        } satisfies AssistCachePayload;
        writeAssistCache(storageKey, payload);
        void writeUiStateToSqlite(ASSIST_CACHE_SCOPE, sqliteKey, payload);
    }, [assistState, assistError, assistOutput, assistDraft, assistCitationsExpanded, lastAssistTrigger, sqliteKey, storageKey]);

    useEffect(() => {
        if (assistState !== "loading" || !lastAssistTrigger) return;
        if (resumeInFlightRef.current) return;
        if (!params.canUseNotebookAssist || !params.notebookAuth || !params.activeRoomId) return;
        resumeInFlightRef.current = true;
        const resume = async (): Promise<void> => {
            if (lastAssistTrigger.type === "query") {
                await runAssistQuery(lastAssistTrigger.query);
                return;
            }
            await runAssistFromContext(lastAssistTrigger.anchorEventId);
        };
        void resume();
    }, [
        assistState,
        lastAssistTrigger,
        params.canUseNotebookAssist,
        params.notebookAuth,
        params.activeRoomId,
        runAssistQuery,
        runAssistFromContext,
    ]);

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
