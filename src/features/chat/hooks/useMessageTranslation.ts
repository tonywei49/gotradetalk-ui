import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { hubTranslate } from "../../../api/hub";
import type { ContactEntry } from "../../../api/contacts";
import { createTranslationCacheStore } from "../translationCache";
import { normalizeHubLanguage, resolveSourceLangHint, shouldTranslateIncomingMessage } from "../translationPolicy";

const TRANSLATION_CACHE_STORAGE_KEY = "gtt_translation_cache_v1";
const TRANSLATION_CACHE_MAX_ITEMS = 1500;

function looksLikeStaleEnglishCache(sourceText: string, translatedText: string, targetLanguage: string): boolean {
    const target = (targetLanguage || "").toLowerCase();
    const isEnglishTarget = target === "en" || target.startsWith("en-");
    if (!isEnglishTarget) return false;
    if (translatedText !== sourceText) return false;
    return /[\u3400-\u9fff]/.test(sourceText);
}

function shouldRetryEnglishTranslation(sourceText: string, translatedText: string, targetLanguage: string): boolean {
    const target = (targetLanguage || "").toLowerCase();
    const isEnglishTarget = target === "en" || target.startsWith("en-");
    if (!isEnglishTarget) return false;
    if (translatedText !== sourceText) return false;
    return /[\u3400-\u9fff]/.test(sourceText);
}

export function getMessageEventKey(event: MatrixEvent): string {
    return event.getId() ?? event.getTxnId() ?? `${event.getTs()}-${event.getSender()}`;
}

type Params = {
    activeRoomId: string | null;
    room: Room | null;
    mergedEvents: MatrixEvent[];
    userId: string | null;
    canTranslate: boolean;
    targetLanguage: string;
    translationDefaultView?: "translated" | "original";
    translateAccessToken: string | null;
    translateHsUrl: string | null;
    translateMatrixUserId: string | null;
    isDirectRoom: boolean;
    isGroupChat?: boolean;
    isMultiMemberRoom?: boolean;
    directTranslationEnabled: boolean;
    groupTranslationEnabled?: boolean;
    roomTranslationEnabled?: boolean;
    userType: string | null;
    companyName?: string | null;
    resolveContactByMatrixUserId: (matrixUserId?: string | null) => ContactEntry | null;
    pushToast: (kind: "error" | "warn" | "success", message: string) => void;
    translationUnavailableText: string;
};

export function useMessageTranslation(params: Params) {
    const {
        activeRoomId,
        room,
        mergedEvents,
        userId,
        canTranslate,
        targetLanguage,
        translationDefaultView,
        translateAccessToken,
        translateHsUrl,
        translateMatrixUserId,
        isDirectRoom,
        isGroupChat,
        isMultiMemberRoom,
        directTranslationEnabled,
        groupTranslationEnabled,
        roomTranslationEnabled,
        userType,
        companyName,
        resolveContactByMatrixUserId,
        pushToast,
        translationUnavailableText,
    } = params;

    const [translationMap, setTranslationMap] = useState<
        Record<string, { text: string | null; loading: boolean; error: boolean }>
    >({});
    const [translationView, setTranslationView] = useState<Record<string, boolean>>({});
    const [translationBlocked, setTranslationBlocked] = useState(false);
    const translationErrorToastRef = useRef<{ key: string; ts: number } | null>(null);
    const translationCacheStore = useMemo(
        () => createTranslationCacheStore(TRANSLATION_CACHE_STORAGE_KEY, TRANSLATION_CACHE_MAX_ITEMS),
        [],
    );

    const shouldTranslateEvent = useCallback(
        (event: MatrixEvent, isMeMessage: boolean): boolean => {
            const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
            const senderId = event.getSender() ?? null;
            const senderContact = resolveContactByMatrixUserId(senderId);
            return shouldTranslateIncomingMessage({
                canTranslate,
                translationBlocked,
                isMeMessage,
                isDirectRoom,
                isGroupChat,
                isMultiMemberRoom,
                directTranslationEnabled,
                groupTranslationEnabled,
                roomTranslationEnabled,
                messageBody: content?.body,
                messageType: content?.msgtype,
                userType,
                companyName,
                senderContact,
            });
        },
        [
            canTranslate,
            translationBlocked,
            isDirectRoom,
            isGroupChat,
            isMultiMemberRoom,
            directTranslationEnabled,
            groupTranslationEnabled,
            roomTranslationEnabled,
            userType,
            companyName,
            resolveContactByMatrixUserId,
        ],
    );

    const requestTranslation = useCallback(
        async (event: MatrixEvent, messageText: string, forceRetry = false): Promise<void> => {
            if (!translateAccessToken) return;
            const messageId = event.getId();
            if (!messageId) return;
            const key = getMessageEventKey(event);
            const isMeMessage = event.getSender() === userId;
            if (!shouldTranslateEvent(event, isMeMessage)) return;
            const roomId = activeRoomId ?? "";

            if (!forceRetry && roomId && targetLanguage) {
                const cachedText = translationCacheStore.read(roomId, messageId, targetLanguage, messageText);
                if (cachedText) {
                    if (looksLikeStaleEnglishCache(messageText, cachedText, targetLanguage)) {
                        // Skip stale same-text cache for English target and CJK source.
                    } else {
                    setTranslationMap((prev) => ({ ...prev, [key]: { text: cachedText, loading: false, error: false } }));
                    setTranslationView((prev) =>
                        prev[key] === undefined
                            ? { ...prev, [key]: translationDefaultView !== "original" }
                            : prev,
                    );
                    return;
                    }
                }
            }

            const senderId = event.getSender() ?? null;
            const senderContact = resolveContactByMatrixUserId(senderId);
            const senderLangHint = (senderContact?.locale || "").trim() || undefined;
            setTranslationMap((prev) => {
                if (prev[key]?.loading) return prev;
                if (!forceRetry && prev[key]) return prev;
                const previousText = prev[key]?.text ?? null;
                return { ...prev, [key]: { text: previousText, loading: true, error: false } };
            });

            try {
                const normalizedTargetLang = normalizeHubLanguage(targetLanguage) ?? targetLanguage;
                const normalizedSourceLangHint = resolveSourceLangHint(senderLangHint, normalizedTargetLang);
                const basePayload = {
                    accessToken: translateAccessToken,
                    text: messageText,
                    targetLang: normalizedTargetLang,
                    sourceLangHint: normalizedSourceLangHint,
                    roomId: activeRoomId ?? undefined,
                    sourceMatrixUserId: event.getSender() ?? undefined,
                    hsUrl: translateHsUrl,
                    matrixUserId: translateMatrixUserId,
                } as const;
                const result = await hubTranslate({ ...basePayload, messageId });
                const retryResult =
                    shouldRetryEnglishTranslation(messageText, result.translation, normalizedTargetLang)
                        ? await hubTranslate(basePayload)
                        : null;
                const finalTranslation = retryResult?.translation ?? result.translation;
                if (roomId && targetLanguage) {
                    translationCacheStore.write(roomId, messageId, targetLanguage, messageText, finalTranslation);
                }
                setTranslationMap((prev) => ({ ...prev, [key]: { text: finalTranslation, loading: false, error: false } }));
                setTranslationView((prev) =>
                    prev[key] === undefined
                        ? { ...prev, [key]: translationDefaultView !== "original" }
                        : prev,
                );
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : typeof error === "string" ? error : "";
                const toastKey = `${activeRoomId ?? "global"}:${message || "unknown"}`;
                const now = Date.now();
                const prevToast = translationErrorToastRef.current;
                if (!prevToast || prevToast.key !== toastKey || now - prevToast.ts > 15000) {
                    translationErrorToastRef.current = { key: toastKey, ts: now };
                    pushToast("error", message || translationUnavailableText);
                }
                if (
                    message.includes("NOT_SUBSCRIBED") ||
                    message.includes("QUOTA_EXCEEDED") ||
                    message.includes("CLIENT_TRANSLATION_DISABLED") ||
                    message.includes("TRANSLATION_NOT_ALLOWED") ||
                    message.includes("403")
                ) {
                    setTranslationBlocked(true);
                }
                setTranslationMap((prev) => ({ ...prev, [key]: { text: null, loading: false, error: true } }));
            }
        },
        [
            shouldTranslateEvent,
            translateAccessToken,
            activeRoomId,
            targetLanguage,
            translationCacheStore,
            userId,
            resolveContactByMatrixUserId,
            translationDefaultView,
            translateHsUrl,
            translateMatrixUserId,
            pushToast,
            translationUnavailableText,
        ],
    );

    useEffect(() => {
        if (!canTranslate || !room || room.isSpaceRoom()) return;
        mergedEvents.forEach((event) => {
            const content = event.getContent() as { body?: string; msgtype?: string } | undefined;
            const messageText = content?.body ?? "";
            const isMeMessage = event.getSender() === userId;
            if (!shouldTranslateEvent(event, isMeMessage)) return;
            const key = getMessageEventKey(event);
            if (translationMap[key]) return;
            void requestTranslation(event, messageText);
        });
    }, [canTranslate, room, mergedEvents, userId, shouldTranslateEvent, translationMap, requestTranslation]);

    useEffect(() => {
        setTranslationMap({});
        setTranslationView({});
        setTranslationBlocked(false);
    }, [targetLanguage, activeRoomId]);

    return {
        translationMap,
        translationView,
        setTranslationView,
        requestTranslation,
    };
}
