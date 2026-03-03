import { MsgType } from "matrix-js-sdk";
import type { ContactEntry } from "../../api/contacts";

type TranslateContext = {
    canTranslate: boolean;
    translationBlocked: boolean;
    isMeMessage: boolean;
    isDirectRoom: boolean;
    isGroupChat?: boolean;
    isMultiMemberRoom?: boolean;
    directTranslationEnabled: boolean;
    groupTranslationEnabled?: boolean;
    roomTranslationEnabled?: boolean;
    messageBody?: string;
    messageType?: string;
    userType?: string | null;
    companyName?: string | null;
    senderContact: ContactEntry | null;
};

function isSameCompanyStaff(
    contact: ContactEntry | null | undefined,
    companyName?: string | null,
): boolean {
    return Boolean(
        contact?.user_type === "staff" &&
        contact.company_name &&
        companyName &&
        contact.company_name === companyName,
    );
}

export function normalizeHubLanguage(language?: string | null): string | undefined {
    const normalized = (language ?? "").trim();
    if (!normalized) return undefined;
    return normalized === "zh-TW" ? "Traditional Chinese" : normalized;
}

export function resolveSourceLangHint(
    sourceLanguage?: string | null,
    targetLanguage?: string | null,
): string | undefined {
    const source = normalizeHubLanguage(sourceLanguage);
    if (!source) return undefined;
    const target = normalizeHubLanguage(targetLanguage);
    if (target && source.toLowerCase() === target.toLowerCase()) {
        // Avoid passing same source/target hint, which can short-circuit translation.
        return undefined;
    }
    return source;
}

export function isDirectTranslationEnabled(params: {
    isDirectRoom: boolean;
    userType?: string | null;
    directPeerContact: ContactEntry | null;
    companyName?: string | null;
}): boolean {
    const { isDirectRoom, userType, directPeerContact, companyName } = params;
    if (!isDirectRoom) return false;
    if (userType === "client") return true;
    if (userType === "staff") {
        if (isSameCompanyStaff(directPeerContact, companyName)) return false;
        return true;
    }
    return true;
}

export function shouldTranslateIncomingMessage(context: TranslateContext): boolean {
    const {
        canTranslate,
        translationBlocked,
        isMeMessage,
        isDirectRoom,
        isGroupChat,
        isMultiMemberRoom,
        directTranslationEnabled,
        groupTranslationEnabled,
        roomTranslationEnabled,
        messageBody,
        messageType,
        userType,
        companyName,
        senderContact,
    } = context;

    if (!canTranslate || translationBlocked || isMeMessage) return false;
    // Keep existing translation flow, but short-circuit client direct chat when
    // peer type is client (or still unknown before contacts resolve), to avoid
    // "pending -> unavailable" flicker on client<->client rooms.
    if (isDirectRoom && userType === "client") {
        if (!senderContact?.user_type) return false;
        if (senderContact.user_type === "client") return false;
    }
    const isMultiMemberConversation = isMultiMemberRoom ?? isGroupChat ?? false;
    const multiMemberTranslationEnabled = roomTranslationEnabled ?? groupTranslationEnabled ?? false;
    if (isDirectRoom && !directTranslationEnabled) return false;
    if (isMultiMemberConversation && !multiMemberTranslationEnabled) return false;
    if (!messageBody) return false;
    if (messageType && messageType !== MsgType.Text) return false;
    if (!isMultiMemberConversation) return true;

    if (userType === "client") return true;
    if (userType === "staff" && isSameCompanyStaff(senderContact, companyName)) return false;
    return true;
}

export function collectGroupClientTargetLanguages(params: {
    memberIds: string[];
    selfUserId?: string | null;
    resolveContactByMatrixUserId: (matrixUserId?: string | null) => ContactEntry | null;
}): string[] {
    const { memberIds, selfUserId, resolveContactByMatrixUserId } = params;
    const targetLangs = new Set<string>();

    memberIds
        .filter((memberId) => memberId && memberId !== selfUserId)
        .forEach((memberId) => {
            const contact = resolveContactByMatrixUserId(memberId);
            if (!contact || contact.user_type !== "client") return;
            const lang = (contact.translation_locale || contact.locale || "").trim();
            if (lang) targetLangs.add(lang);
        });

    return Array.from(targetLangs);
}
