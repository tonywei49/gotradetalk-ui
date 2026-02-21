import { MsgType, type MatrixClient } from "matrix-js-sdk";
import { hubTranslate } from "../../api/hub";
import {
    collectGroupClientTargetLanguages,
    normalizeHubLanguage,
    resolveSourceLangHint,
} from "./translationPolicy";
import type { ContactEntry } from "../../api/contacts";
import { sendFileMessageEvent, sendTextMessageEvent } from "../../matrix/adapters/chatAdapter";

export type ReadyAttachment = {
    fileName: string;
    fileSize: number;
    mimeType: string;
    msgtype: MsgType;
    isPdf: boolean;
    mxcUrl: string;
};

type TranslateContext = {
    accessToken?: string | null;
    hsUrl?: string | null;
    matrixUserId?: string | null;
    sourceMatrixUserId?: string | null;
    sourceLang?: string | null;
};

export async function sendTextMessage(
    matrixClient: MatrixClient,
    roomId: string,
    text: string,
): Promise<string | undefined> {
    return sendTextMessageEvent(matrixClient, roomId, text);
}

export async function sendReadyAttachments(
    matrixClient: MatrixClient,
    roomId: string,
    attachments: ReadyAttachment[],
): Promise<void> {
    for (const attachment of attachments) {
        const info: { mimetype?: string; size: number } = { size: attachment.fileSize };
        if (attachment.mimeType) info.mimetype = attachment.mimeType;
        if (attachment.isPdf && !info.mimetype) info.mimetype = "application/pdf";

        const content: Record<string, unknown> = {
            body: attachment.fileName,
            msgtype: attachment.msgtype,
            url: attachment.mxcUrl,
            info,
        };
        await sendFileMessageEvent(matrixClient, roomId, content);
    }
}

export function pretranslateDirectToClient(params: {
    enabled: boolean;
    text: string;
    messageId?: string;
    roomId: string;
    peerLanguage?: string | null;
    translate: TranslateContext;
}): void {
    const { enabled, text, messageId, roomId, peerLanguage, translate } = params;
    if (!enabled || !messageId || !translate.accessToken) return;
    const normalizedTargetLang = normalizeHubLanguage(peerLanguage) ?? (peerLanguage ?? "").trim();
    if (!normalizedTargetLang) return;
    const normalizedSourceLangHint = resolveSourceLangHint(translate.sourceLang, normalizedTargetLang);

    void hubTranslate({
        accessToken: translate.accessToken,
        text,
        targetLang: normalizedTargetLang,
        sourceLangHint: normalizedSourceLangHint,
        roomId,
        messageId,
        sourceMatrixUserId: translate.sourceMatrixUserId ?? undefined,
        hsUrl: translate.hsUrl ?? undefined,
        matrixUserId: translate.matrixUserId ?? undefined,
    }).catch(() => undefined);
}

export function pretranslateGroupToClients(params: {
    enabled: boolean;
    text: string;
    messageId?: string;
    roomId: string;
    memberIds: string[];
    selfUserId?: string | null;
    resolveContactByMatrixUserId: (matrixUserId?: string | null) => ContactEntry | null;
    translate: TranslateContext;
}): void {
    const {
        enabled,
        text,
        messageId,
        roomId,
        memberIds,
        selfUserId,
        resolveContactByMatrixUserId,
        translate,
    } = params;

    if (!enabled || !messageId || !translate.accessToken) return;
    const targetLangs = collectGroupClientTargetLanguages({
        memberIds,
        selfUserId,
        resolveContactByMatrixUserId,
    });

    targetLangs.forEach((lang) => {
        const normalizedTargetLang = normalizeHubLanguage(lang) ?? lang;
        const normalizedSourceLangHint = resolveSourceLangHint(translate.sourceLang, normalizedTargetLang);
        void hubTranslate({
            accessToken: translate.accessToken as string,
            text,
            targetLang: normalizedTargetLang,
            sourceLangHint: normalizedSourceLangHint,
            roomId,
            messageId,
            sourceMatrixUserId: translate.sourceMatrixUserId ?? undefined,
            hsUrl: translate.hsUrl ?? undefined,
            matrixUserId: translate.matrixUserId ?? undefined,
        }).catch(() => undefined);
    });
}
