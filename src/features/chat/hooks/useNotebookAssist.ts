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

function createEmptyAssistPayload(): AssistCachePayload {
    return {
        assistState: "idle",
        assistError: null,
        assistOutput: null,
        assistDraft: "",
        assistCitationsExpanded: false,
        lastAssistTrigger: null,
    };
}

function getAssistStorageKey(roomId: string | null): string {
    return roomId ? `${ASSIST_CACHE_KEY_PREFIX}:${roomId}` : "";
}

function getAssistSqliteKey(matrixUserId: string | null | undefined, roomId: string | null): string | null {
    return matrixUserId && roomId ? `${matrixUserId}:${roomId}` : null;
}

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
        () => getAssistStorageKey(params.activeRoomId),
        [params.activeRoomId],
    );
    const sqliteKey = useMemo(
        () => getAssistSqliteKey(params.notebookAuth?.matrixUserId, params.activeRoomId),
        [params.activeRoomId, params.notebookAuth?.matrixUserId],
    );
    const activeRoomIdRef = useRef<string | null>(params.activeRoomId);
    const activeMatrixUserIdRef = useRef<string | null>(params.notebookAuth?.matrixUserId ?? null);
    const inFlightRequestByRoomRef = useRef<Map<string, symbol>>(new Map());
    const initialCache = readAssistCache(storageKey);
    const [assistState, setAssistState] = useState<"idle" | "loading" | "success" | "error">(initialCache?.assistState ?? "idle");
    const [assistError, setAssistError] = useState<string | null>(initialCache?.assistError ?? null);
    const [assistOutput, setAssistOutput] = useState<NotebookAssistResponse | null>(initialCache?.assistOutput ?? null);
    const [assistDraft, setAssistDraft] = useState(initialCache?.assistDraft ?? "");
    const [assistCitationsExpanded, setAssistCitationsExpanded] = useState(Boolean(initialCache?.assistCitationsExpanded));
    const [lastAssistTrigger, setLastAssistTrigger] = useState<AssistTrigger | null>(initialCache?.lastAssistTrigger ?? null);
    const hydratedStorageKeyRef = useRef<string>(storageKey);

    useEffect(() => {
        activeRoomIdRef.current = params.activeRoomId;
        activeMatrixUserIdRef.current = params.notebookAuth?.matrixUserId ?? null;
    }, [params.activeRoomId, params.notebookAuth?.matrixUserId]);

    const applyLocalPayload = useCallback((payload: AssistCachePayload): void => {
        setAssistState(payload.assistState);
        setAssistError(payload.assistError);
        setAssistOutput(payload.assistOutput);
        setAssistDraft(payload.assistDraft);
        setAssistCitationsExpanded(payload.assistCitationsExpanded);
        setLastAssistTrigger(payload.lastAssistTrigger);
    }, []);

    const persistPayloadForRoom = useCallback((
        roomId: string | null,
        matrixUserId: string | null | undefined,
        payload: AssistCachePayload,
    ): void => {
        const nextStorageKey = getAssistStorageKey(roomId);
        const nextSqliteKey = getAssistSqliteKey(matrixUserId, roomId);
        writeAssistCache(nextStorageKey, payload);
        void writeUiStateToSqlite(ASSIST_CACHE_SCOPE, nextSqliteKey, payload);
        if (activeRoomIdRef.current === roomId && activeMatrixUserIdRef.current === (matrixUserId ?? null)) {
            applyLocalPayload(payload);
        }
    }, [applyLocalPayload]);

    const readCachedPayloadForRoom = useCallback((
        roomId: string | null,
        fallback: AssistCachePayload,
    ): AssistCachePayload => {
        const cached = readAssistCache(getAssistStorageKey(roomId));
        return cached ?? fallback;
    }, []);

    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (!storageKey || hydratedStorageKeyRef.current === storageKey) return;
        hydratedStorageKeyRef.current = storageKey;
        const cached = readAssistCache(storageKey);
        if (!cached) {
            applyLocalPayload(createEmptyAssistPayload());
            return;
        }
        applyLocalPayload(cached);
    }, [applyLocalPayload, storageKey]);
    /* eslint-enable react-hooks/set-state-in-effect */

    useEffect(() => {
        if (!storageKey) return;
        let disposed = false;
        void readUiStateFromSqlite<AssistCachePayload>(ASSIST_CACHE_SCOPE, sqliteKey, ASSIST_CACHE_TTL_MS)
            .then((cached) => {
                if (disposed || !cached) return;
                applyLocalPayload(cached);
            })
            .catch(() => undefined);
        return () => {
            disposed = true;
        };
    }, [applyLocalPayload, sqliteKey, storageKey]);

    const ensureKnowledgeBaseAvailable = useCallback(async (
        notebookAuth: NotebookAuthContext | null,
        knowledgeScope: "personal" | "company" | "both",
    ): Promise<boolean> => {
        if (!notebookAuth) return false;
        const list = await params.adapter.listItems(notebookAuth, {
            filter: "knowledge",
            scope: knowledgeScope,
        });
        return list.length > 0;
    }, [params.adapter]);

    const runAssistQuery = useCallback(async (query: string): Promise<void> => {
        if (!params.canUseNotebookAssist || !params.notebookAuth || !params.activeRoomId) return;
        const trimmed = query.trim();
        if (!trimmed) {
            setAssistState("error");
            setAssistError(params.t("chat.notebook.errors.emptyQuery"));
            return;
        }
        const roomId = params.activeRoomId;
        const notebookAuth = params.notebookAuth;
        const matrixUserId = notebookAuth.matrixUserId;
        const knowledgeScope = params.knowledgeScope || "both";
        const responseLang = (params.responseLang || "").trim() || "zh-TW";
        const trigger: AssistTrigger = { type: "query", query: trimmed };
        const requestToken = Symbol(`assist-query:${roomId}`);
        const loadingPayload: AssistCachePayload = {
            assistState: "loading",
            assistError: null,
            assistOutput,
            assistDraft,
            assistCitationsExpanded,
            lastAssistTrigger: trigger,
        };
        inFlightRequestByRoomRef.current.set(roomId, requestToken);
        persistPayloadForRoom(roomId, matrixUserId, loadingPayload);
        try {
            const hasKnowledgeBase = await ensureKnowledgeBaseAvailable(notebookAuth, knowledgeScope);
            if (inFlightRequestByRoomRef.current.get(roomId) !== requestToken) return;
            if (!hasKnowledgeBase) {
                persistPayloadForRoom(roomId, matrixUserId, {
                    ...readCachedPayloadForRoom(roomId, loadingPayload),
                    assistState: "error",
                    assistError: params.t("chat.notebook.errors.noKnowledgeBaseItems"),
                });
                return;
            }
            const result = await params.adapter.assistQuery(notebookAuth, {
                roomId,
                query: trimmed,
                knowledgeScope,
                responseLang,
            });
            if (inFlightRequestByRoomRef.current.get(roomId) !== requestToken) return;
            persistPayloadForRoom(roomId, matrixUserId, {
                ...readCachedPayloadForRoom(roomId, loadingPayload),
                assistState: "success",
                assistError: null,
                assistOutput: result,
                assistDraft: (result.referenceAnswer || result.answer || result.summaryText || "").trim(),
                lastAssistTrigger: trigger,
            });
        } catch (error) {
            if (inFlightRequestByRoomRef.current.get(roomId) !== requestToken) return;
            if (isNotebookTerminalAuthFailure(error)) {
                params.onTerminalAuthFailure?.(error);
                persistPayloadForRoom(roomId, matrixUserId, {
                    ...readCachedPayloadForRoom(roomId, loadingPayload),
                    assistState: "idle",
                    assistError: null,
                });
                return;
            }
            persistPayloadForRoom(roomId, matrixUserId, {
                ...readCachedPayloadForRoom(roomId, loadingPayload),
                assistState: "error",
                assistError: mapNotebookErrorToMessage(error, params.t),
            });
        } finally {
            if (inFlightRequestByRoomRef.current.get(roomId) === requestToken) {
                inFlightRequestByRoomRef.current.delete(roomId);
            }
        }
    }, [
        assistCitationsExpanded,
        assistDraft,
        assistOutput,
        ensureKnowledgeBaseAvailable,
        params,
        persistPayloadForRoom,
        readCachedPayloadForRoom,
    ]);

    const runAssistFromContext = useCallback(async (anchorEventId: string): Promise<void> => {
        if (!params.canUseNotebookAssist || !params.notebookAuth || !params.activeRoomId) return;
        const roomId = params.activeRoomId;
        const notebookAuth = params.notebookAuth;
        const matrixUserId = notebookAuth.matrixUserId;
        const knowledgeScope = params.knowledgeScope || "both";
        const responseLang = (params.responseLang || "").trim() || "zh-TW";
        const trigger: AssistTrigger = { type: "context", anchorEventId, windowSize: NOTEBOOK_ASSIST_CONTEXT_WINDOW_SIZE };
        const requestToken = Symbol(`assist-context:${roomId}`);
        const loadingPayload: AssistCachePayload = {
            assistState: "loading",
            assistError: null,
            assistOutput,
            assistDraft,
            assistCitationsExpanded,
            lastAssistTrigger: trigger,
        };
        inFlightRequestByRoomRef.current.set(roomId, requestToken);
        persistPayloadForRoom(roomId, matrixUserId, loadingPayload);
        try {
            const hasKnowledgeBase = await ensureKnowledgeBaseAvailable(notebookAuth, knowledgeScope);
            if (inFlightRequestByRoomRef.current.get(roomId) !== requestToken) return;
            if (!hasKnowledgeBase) {
                persistPayloadForRoom(roomId, matrixUserId, {
                    ...readCachedPayloadForRoom(roomId, loadingPayload),
                    assistState: "error",
                    assistError: params.t("chat.notebook.errors.noKnowledgeBaseItems"),
                });
                return;
            }
            const result = await params.adapter.assistFromContext(notebookAuth, {
                roomId,
                anchorEventId,
                windowSize: NOTEBOOK_ASSIST_CONTEXT_WINDOW_SIZE,
                knowledgeScope,
                responseLang,
            });
            if (inFlightRequestByRoomRef.current.get(roomId) !== requestToken) return;
            persistPayloadForRoom(roomId, matrixUserId, {
                ...readCachedPayloadForRoom(roomId, loadingPayload),
                assistState: "success",
                assistError: null,
                assistOutput: result,
                assistDraft: (result.referenceAnswer || result.answer || result.summaryText || "").trim(),
                lastAssistTrigger: trigger,
            });
        } catch (error) {
            if (inFlightRequestByRoomRef.current.get(roomId) !== requestToken) return;
            if (isNotebookTerminalAuthFailure(error)) {
                params.onTerminalAuthFailure?.(error);
                persistPayloadForRoom(roomId, matrixUserId, {
                    ...readCachedPayloadForRoom(roomId, loadingPayload),
                    assistState: "idle",
                    assistError: null,
                });
                return;
            }
            persistPayloadForRoom(roomId, matrixUserId, {
                ...readCachedPayloadForRoom(roomId, loadingPayload),
                assistState: "error",
                assistError: mapNotebookErrorToMessage(error, params.t),
            });
        } finally {
            if (inFlightRequestByRoomRef.current.get(roomId) === requestToken) {
                inFlightRequestByRoomRef.current.delete(roomId);
            }
        }
    }, [
        assistCitationsExpanded,
        assistDraft,
        assistOutput,
        ensureKnowledgeBaseAvailable,
        params,
        persistPayloadForRoom,
        readCachedPayloadForRoom,
    ]);

    const resetAssist = useCallback(() => {
        if (params.activeRoomId) {
            inFlightRequestByRoomRef.current.delete(params.activeRoomId);
        }
        persistPayloadForRoom(params.activeRoomId, params.notebookAuth?.matrixUserId, createEmptyAssistPayload());
    }, [params.activeRoomId, params.notebookAuth?.matrixUserId, persistPayloadForRoom]);

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
        if (!params.canUseNotebookAssist || !params.notebookAuth || !params.activeRoomId) return;
        if (inFlightRequestByRoomRef.current.has(params.activeRoomId)) return;
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
