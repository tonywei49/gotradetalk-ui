import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MatrixClient, Room } from "matrix-js-sdk";
import type { ChatSummaryJobDetail, ChatSummaryJobItem } from "../api/hub";
import {
    ChatSearchError,
} from "../features/chat/chatSearchApi";
import {
    type SummaryDirectionPayload,
    type SummarySearchPersonItem,
    type SummarySearchRoomItem,
    type SummarySearchTarget,
} from "../features/notebook/components/NotebookSidebar";
import type { NotebookAuthContext } from "../features/notebook/types";
import type { NotebookTerminalAuthFailureSignal } from "../features/notebook/utils/isNotebookTerminalAuthFailure";
import {
    MATRIX_EVENT_TYPE_ROOM_CREATE,
    MATRIX_EVENT_TYPE_ROOM_MEMBER,
    MATRIX_EVENT_TYPE_ROOM_NAME,
} from "../matrix/matrixEventConstants";

const NotebookWorkspaceDesktop = lazy(async () => {
    const module = await import("../features/notebook/components/NotebookWorkspaceDesktop");
    return { default: module.NotebookWorkspaceDesktop };
});

const NotebookSummaryMarkdown = lazy(async () => {
    const module = await import("../features/notebook/components/NotebookSummaryMarkdown");
    return { default: module.NotebookSummaryMarkdown };
});

const CHAT_GLOBAL_SEARCH_DEBOUNCE_MS = 350;
const SUMMARY_MAX_RANGE_MS = 72 * 60 * 60 * 1000;

function formatMatrixUserLocalId(matrixUserId: string | null | undefined): string {
    const raw = String(matrixUserId || "").trim();
    if (!raw) return "";
    const withoutPrefix = raw.startsWith("@") ? raw.slice(1) : raw;
    const colonIndex = withoutPrefix.indexOf(":");
    return colonIndex > 0 ? withoutPrefix.slice(0, colonIndex) : withoutPrefix;
}

function resolveRoomListDisplayName(room: Room, myUserId: string | null): string {
    const fallback = room.name || room.getCanonicalAlias() || room.roomId;
    const explicitNameEvent = room.currentState.getStateEvents(MATRIX_EVENT_TYPE_ROOM_NAME, "");
    const explicitName = String((explicitNameEvent?.getContent() as { name?: string } | undefined)?.name || "").trim();
    if (explicitName) return explicitName;
    const normalizedMyUserId = myUserId || null;
    const joinedMembers = room.getJoinedMembers();
    if (normalizedMyUserId && joinedMembers.length === 2) {
        const other = joinedMembers.find((member) => member.userId !== normalizedMyUserId);
        if (other) {
            return other.name || formatMatrixUserLocalId(other.userId) || other.userId || fallback;
        }
    }

    if (normalizedMyUserId) {
        const selfMemberEvent = room.currentState.getStateEvents(MATRIX_EVENT_TYPE_ROOM_MEMBER, normalizedMyUserId);
        const isDirect = Boolean(selfMemberEvent?.getContent()?.is_direct);
        if (isDirect) {
            const other = room
                .getMembers()
                .find((member) => member.userId !== normalizedMyUserId && (member.membership === "join" || member.membership === "invite"));
            if (other) {
                return other.name || formatMatrixUserLocalId(other.userId) || other.userId || fallback;
            }
        }
    }

    return fallback;
}

function resolveRoomCreatedAt(room: Room): number | null {
    const createEvent = room.currentState.getStateEvents(MATRIX_EVENT_TYPE_ROOM_CREATE, "");
    if (!createEvent) return null;
    const ts = createEvent.getTs();
    return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function parseDateTimeInputToIso(value: string): string | null {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapChatSummaryErrorMessage(
    message: string,
    t: (key: string, defaultValue: string, options?: Record<string, unknown>) => string,
): string {
    const raw = String(message || "").trim();
    const normalized = raw.toLowerCase();
    const extractLimit = (input: string): string | null => {
        const match = input.match(/\((\d+)(?:\/day)?\)/i);
        return match?.[1] || null;
    };

    if (normalized.includes("daily summary limit reached")) {
        const limit = extractLimit(raw);
        return t("layout.notebook.summaryDailyLimitReached", "Daily summary limit reached ({{limit}}/day).", { limit: limit || "0" });
    }
    if (normalized.includes("too many running summary jobs")) {
        const limit = extractLimit(raw);
        return t("layout.notebook.summaryProcessingLimitReached", "Too many running summary jobs (max {{limit}}).", { limit: limit || "1" });
    }
    if (normalized.includes("date range cannot exceed 3 days")) {
        return t("layout.notebook.summaryRangeExceeded", "Time range cannot exceed 3 days.");
    }
    if (normalized.includes("no valid chat content for summary after filtering")) {
        return t("layout.notebook.summaryNoValidChatContent", "No valid chat content after filtering. Please widen the time range and try again.");
    }
    if (normalized.includes("only room members can generate summary")) {
        return t("layout.notebook.summaryOnlyRoomMembers", "Only room members can generate summary.");
    }
    if (normalized.includes("missing hs_url") || normalized.includes("matrix access token")) {
        return t("layout.notebook.summarySearchAuthRequired", "Please sign in again before searching.");
    }
    if (normalized === "unauthorized" || normalized.includes("missing auth token") || normalized.includes("invalid auth token")) {
        return t("layout.notebook.summarySearchUnauthorized", "Authentication failed. Please sign in again.");
    }
    if (normalized.includes("m_unknown_token") || normalized.includes("unknown access token")) {
        return t("layout.notebook.summarySearchUnauthorized", "Authentication failed. Please sign in again.");
    }
    if (normalized.includes("failed to load summary jobs")) {
        return t("layout.notebook.summaryJobsLoadFailed", "Failed to load summary list.");
    }
    if (normalized.includes("failed to delete summary job")) {
        return t("layout.notebook.summaryDeleteFailed", "Failed to delete summary.");
    }
    if (normalized.includes("failed to download summary")) {
        return t("layout.notebook.summaryDownloadFailed", "Failed to download summary.");
    }
    if (normalized.includes("failed to load summary detail")) {
        return t("layout.notebook.summaryPreviewFailed", "Failed to load summary preview.");
    }
    if (normalized.includes("summary job not found")) {
        return t("layout.notebook.summaryJobNotFound", "Summary record not found.");
    }
    if (normalized.includes("summary is not ready")) {
        return t("layout.notebook.summaryNotReady", "Summary is still generating. Please try again later.");
    }
    if (normalized.includes("failed to create summary job")) {
        return t("layout.notebook.summaryGenerateFailed", "Failed to start summary generation.");
    }
    return raw || t("layout.notebook.summaryGenerateFailed", "Failed to start summary generation.");
}

function isSummaryRangeExceeded(startValue: string, endValue: string): boolean {
    const startIso = parseDateTimeInputToIso(startValue);
    const endIso = parseDateTimeInputToIso(endValue);
    if (!startIso || !endIso) return false;
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
    if (endMs < startMs) return false;
    return endMs - startMs > SUMMARY_MAX_RANGE_MS;
}

function toCompactDateTime(value: string): string {
    const iso = parseDateTimeInputToIso(value);
    if (!iso) return "";
    return iso.slice(0, 16).replace(/[-:T]/g, "");
}

function formatSummaryDisplayDateTime(value: string | null | undefined): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    const year = parsed.getFullYear();
    const month = parsed.getMonth() + 1;
    const day = parsed.getDate();
    const hour = String(parsed.getHours()).padStart(2, "0");
    const minute = String(parsed.getMinutes()).padStart(2, "0");
    return `${year}/${month}/${day} ${hour}:${minute}`;
}

function formatSummaryDisplayDate(value: string | null | undefined): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    const year = parsed.getFullYear();
    const month = parsed.getMonth() + 1;
    const day = parsed.getDate();
    return `${year}/${month}/${day}`;
}

export type NotebookPanelProps = {
    auth: NotebookAuthContext | null;
    enabled: boolean;
    refreshToken: number;
    onAuthFailure: () => Promise<string | null>;
    onTerminalAuthFailure: (signal: NotebookTerminalAuthFailureSignal) => void;
    workspaceAvailable: boolean;
    userType: string | null;
    matrixClient: MatrixClient | null;
    matrixCredentials: { user_id?: string; access_token?: string; hs_url?: string } | null;
    matrixAccessToken: string | null;
    matrixHsUrl: string | null;
    hubAccessToken: string | null;
    runHubSessionRequest: <T>(fn: (accessToken: string) => Promise<T>) => Promise<T>;
    uploadLimitMb: number;
    pushToast: (tone: "error" | "warn" | "success", message: string, duration?: number) => void;
    onOpenPreview: (payload: { url: string; type: "image" | "video" | "audio" | "pdf"; name: string; revokeOnClose?: boolean }) => void;
    activeTab: string;
    /** Fallback loading UI when the lazy module is not ready */
    fallback: ReactNode;
};

export const NotebookPanel: React.FC<NotebookPanelProps> = ({
    auth,
    enabled,
    refreshToken,
    onAuthFailure,
    onTerminalAuthFailure,
    workspaceAvailable,
    userType,
    matrixClient,
    matrixCredentials,
    matrixAccessToken,
    matrixHsUrl,
    hubAccessToken,
    runHubSessionRequest,
    uploadLimitMb,
    pushToast,
    onOpenPreview,
    activeTab,
    fallback,
}) => {
    const { t } = useTranslation();

    // -- Summary state --
    const [notebookSidebarMode, setNotebookSidebarMode] = useState<"notebook" | "chatSummary">("notebook");
    const [summarySearchQuery, setSummarySearchQuery] = useState("");
    const [debouncedSummarySearchQuery, setDebouncedSummarySearchQuery] = useState("");
    const [summarySearchLoading, setSummarySearchLoading] = useState(false);
    const [summarySearchError, setSummarySearchError] = useState<string | null>(null);
    const [summaryPeopleResults, setSummaryPeopleResults] = useState<SummarySearchPersonItem[]>([]);
    const [summaryRoomResults, setSummaryRoomResults] = useState<SummarySearchRoomItem[]>([]);
    const [summarySelectedTarget, setSummarySelectedTarget] = useState<SummarySearchTarget | null>(null);
    const [summaryStartDate, setSummaryStartDate] = useState("");
    const [summaryEndDate, setSummaryEndDate] = useState("");
    const [summaryContentLoading, setSummaryContentLoading] = useState(false);
    const [summaryJobs, setSummaryJobs] = useState<ChatSummaryJobItem[]>([]);
    const [summaryJobsLoading, setSummaryJobsLoading] = useState(false);
    const [summaryJobsRefreshing, setSummaryJobsRefreshing] = useState(false);
    const [summaryJobsError, setSummaryJobsError] = useState<string | null>(null);
    const [summaryJobActionBusy, setSummaryJobActionBusy] = useState(false);
    const [summaryGenerationNotice, setSummaryGenerationNotice] = useState<string | null>(null);
    const [summaryGenerationNoticeTone, setSummaryGenerationNoticeTone] = useState<"info" | "error">("info");
    const [summaryPreviewJob, setSummaryPreviewJob] = useState<ChatSummaryJobDetail | null>(null);
    const [summaryPreviewLoading, setSummaryPreviewLoading] = useState(false);
    const [summaryPreviewError, setSummaryPreviewError] = useState<string | null>(null);

    // -- Debounce summary search query --
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSummarySearchQuery(summarySearchQuery.trim());
        }, CHAT_GLOBAL_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [summarySearchQuery]);

    // -- Summary search --
    const runSummarySearch = useCallback(async (params?: { forceQuery?: string }) => {
        const q = (params?.forceQuery ?? debouncedSummarySearchQuery).trim();
        if (!q) {
            setSummaryPeopleResults([]);
            setSummaryRoomResults([]);
            setSummarySearchError(null);
            setSummarySelectedTarget(null);
            return;
        }
        if (!hubAccessToken || !matrixAccessToken || !matrixHsUrl || !matrixCredentials?.user_id) {
            setSummarySearchError(t("layout.notebook.summarySearchAuthRequired", "Please sign in again before searching."));
            setSummaryPeopleResults([]);
            setSummaryRoomResults([]);
            setSummarySelectedTarget(null);
            return;
        }

        setSummarySearchLoading(true);
        setSummarySearchError(null);
        try {
            const { chatSearchGlobal } = await import("../features/chat/chatSearchApi");
            const response = await runHubSessionRequest((accessToken) => chatSearchGlobal({
                accessToken,
                matrixAccessToken,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials.user_id!,
            }, {
                q,
                limit: 20,
            }));
            const normalizedQuery = q.trim().toLowerCase();
            const normalizedQueryNoAt = normalizedQuery.startsWith("@") ? normalizedQuery.slice(1) : normalizedQuery;
            const queryLocalId = normalizedQueryNoAt.split(":")[0] || normalizedQueryNoAt;

            const scorePersonMatch = (candidate: {
                id: string;
                label?: string | null;
                userLocalId?: string | null;
                matrixUserId?: string | null;
            }): number => {
                const matrixUserId = String(candidate.matrixUserId || candidate.id || "").toLowerCase();
                const matrixUserIdNoAt = matrixUserId.startsWith("@") ? matrixUserId.slice(1) : matrixUserId;
                const localId = String(candidate.userLocalId || formatMatrixUserLocalId(candidate.matrixUserId || candidate.id) || "").toLowerCase();
                const label = String(candidate.label || "").toLowerCase();

                if (matrixUserId === normalizedQuery || matrixUserIdNoAt === normalizedQueryNoAt || localId === queryLocalId) {
                    return 3;
                }
                if (label === normalizedQuery) return 2;
                if (
                    localId.includes(queryLocalId)
                    || matrixUserId.includes(normalizedQuery)
                    || matrixUserIdNoAt.includes(normalizedQueryNoAt)
                    || label.includes(normalizedQuery)
                ) {
                    return 1;
                }
                return 0;
            };

            const apiPeopleHits: SummarySearchPersonItem[] = response.people_hits
                .filter((hit) => Boolean(hit.matrix_user_id))
                .map((hit) => {
                    const muid = hit.matrix_user_id as string;
                    return {
                        id: muid,
                        label: hit.display_name || hit.user_local_id || muid,
                        meta: hit.company_name || muid,
                    };
                });

            const mergedPeopleMap = new Map<string, SummarySearchPersonItem>();
            for (const item of apiPeopleHits) {
                mergedPeopleMap.set(item.id, item);
            }

            if (matrixClient) {
                const myUserId = matrixCredentials?.user_id || null;
                const rooms = matrixClient.getRooms().filter((room) => room.getMyMembership() === "join" && !room.isSpaceRoom());
                for (const room of rooms) {
                    const members = room.getMembers().filter((member) => member.membership === "join");
                    for (const member of members) {
                        const muid = String(member.userId || "").trim();
                        if (!muid || (myUserId && muid === myUserId)) continue;
                        const localId = formatMatrixUserLocalId(muid);
                        const displayName = String(member.name || "").trim();
                        const score = scorePersonMatch({
                            id: muid,
                            label: displayName || localId || muid,
                            userLocalId: localId,
                            matrixUserId: muid,
                        });
                        if (score <= 0) continue;
                        if (!mergedPeopleMap.has(muid)) {
                            mergedPeopleMap.set(muid, {
                                id: muid,
                                label: displayName || localId || muid,
                                meta: muid,
                            });
                        }
                    }
                }
            }

            const peopleHits = Array.from(mergedPeopleMap.values()).sort((a, b) => {
                const aScore = scorePersonMatch({
                    id: a.id,
                    label: a.label,
                    matrixUserId: a.id,
                    userLocalId: formatMatrixUserLocalId(a.id),
                });
                const bScore = scorePersonMatch({
                    id: b.id,
                    label: b.label,
                    matrixUserId: b.id,
                    userLocalId: formatMatrixUserLocalId(b.id),
                });
                if (aScore !== bScore) return bScore - aScore;
                return a.label.localeCompare(b.label);
            });

            let roomHits: SummarySearchRoomItem[] = [];
            if (matrixClient) {
                const allJoinedRooms = matrixClient
                    .getRooms()
                    .filter((room) => room.getMyMembership() === "join" && !room.isSpaceRoom())
                    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());

                const personIds = new Set(peopleHits.map((item) => item.id));
                const sharedRooms = personIds.size > 0
                    ? allJoinedRooms.filter((room) =>
                        room
                            .getMembers()
                            .some((member) => member.membership === "join" && personIds.has(member.userId)),
                    )
                    : [];

                const fuzzyNameRooms = allJoinedRooms.filter((room) => {
                    const displayName = resolveRoomListDisplayName(room, matrixCredentials?.user_id ?? null);
                    return displayName.toLowerCase().includes(normalizedQuery);
                });

                const dedupedRooms: Room[] = [];
                const seen = new Set<string>();
                for (const room of [...sharedRooms, ...fuzzyNameRooms]) {
                    if (seen.has(room.roomId)) continue;
                    seen.add(room.roomId);
                    dedupedRooms.push(room);
                }

                roomHits = dedupedRooms.map((room) => {
                    const createdAtTs = resolveRoomCreatedAt(room);
                    const resolvedName = resolveRoomListDisplayName(room, matrixCredentials?.user_id ?? null).trim();
                    return {
                        id: room.roomId,
                        label: resolvedName || room.roomId,
                        meta: createdAtTs
                            ? t("layout.notebook.summaryCreatedDate", {
                                date: new Date(createdAtTs).toLocaleString(),
                                defaultValue: "Created at: {{date}}",
                            })
                            : null,
                    };
                });
            } else {
                roomHits = response.room_hits.map((hit) => ({
                    id: hit.room_id,
                    label: hit.room_name || hit.room_id,
                    meta: hit.last_ts
                        ? t("layout.notebook.summaryCreatedDate", {
                            date: new Date(hit.last_ts).toLocaleString(),
                            defaultValue: "Created at: {{date}}",
                        })
                        : null,
                }));
            }

            setSummaryPeopleResults(peopleHits);
            setSummaryRoomResults(roomHits);
            setSummarySelectedTarget((prev) => {
                if (!prev) return null;
                const stillExists = prev.type === "person"
                    ? peopleHits.some((item) => item.id === prev.id)
                    : roomHits.some((item) => item.id === prev.id);
                return stillExists ? prev : null;
            });
        } catch (error) {
            if (error instanceof ChatSearchError) {
                if (error.status === 401) {
                    setSummarySearchError(t("layout.notebook.summarySearchUnauthorized", "Authentication failed. Please sign in again."));
                } else if (error.status === 403) {
                    setSummarySearchError(t("layout.notebook.summarySearchForbidden", "You do not have permission to use chat search."));
                } else {
                    setSummarySearchError(error.message || t("layout.notebook.summarySearchFailed", "Chat search failed."));
                }
            } else {
                setSummarySearchError(error instanceof Error ? error.message : t("layout.notebook.summarySearchFailed", "Chat search failed."));
            }
            setSummaryPeopleResults([]);
            setSummaryRoomResults([]);
            setSummarySelectedTarget(null);
        } finally {
            setSummarySearchLoading(false);
        }
    }, [
        debouncedSummarySearchQuery,
        hubAccessToken,
        matrixAccessToken,
        matrixClient,
        matrixCredentials?.user_id,
        matrixHsUrl,
        runHubSessionRequest,
        t,
    ]);

    useEffect(() => {
        if (activeTab !== "notebook" || notebookSidebarMode !== "chatSummary") return;
        if (!debouncedSummarySearchQuery) {
            setSummaryPeopleResults([]);
            setSummaryRoomResults([]);
            setSummarySearchError(null);
            setSummarySelectedTarget(null);
            return;
        }
        void runSummarySearch();
    }, [activeTab, notebookSidebarMode, debouncedSummarySearchQuery, runSummarySearch]);

    const resolveSummaryTargetRoomId = useCallback((target: SummarySearchTarget): string | null => {
        if (!matrixClient) return null;
        if (target.type === "room") return target.id;
        const candidates = matrixClient
            .getRooms()
            .filter((room) => {
                if (room.getMyMembership() !== "join" || room.isSpaceRoom()) return false;
                const member = room.getMember(target.id);
                return member?.membership === "join";
            })
            .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
        return candidates[0]?.roomId ?? null;
    }, [matrixClient]);

    const loadSummaryJobs = useCallback(async (options?: { background?: boolean }) => {
        if (!hubAccessToken) return;
        const background = Boolean(options?.background);
        if (background) {
            setSummaryJobsRefreshing(true);
        } else {
            setSummaryJobsLoading(true);
            setSummaryJobsError(null);
        }
        try {
            const { listChatSummaryJobs } = await import("../api/hub");
            const response = await runHubSessionRequest((accessToken) => listChatSummaryJobs({
                accessToken,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials?.user_id ?? null,
                matrixAccessToken,
            }));
            setSummaryJobs(Array.isArray(response.items) ? response.items : []);
        } catch (error) {
            const message = error instanceof Error
                ? mapChatSummaryErrorMessage(error.message, t)
                : t("layout.notebook.summaryJobsLoadFailed", "Failed to load summary list.");
            if (background) {
                // silently ignore background refresh errors
            } else {
                setSummaryJobsError(message);
            }
        } finally {
            if (background) {
                setSummaryJobsRefreshing(false);
            } else {
                setSummaryJobsLoading(false);
            }
        }
    }, [hubAccessToken, matrixAccessToken, matrixCredentials?.user_id, matrixHsUrl, runHubSessionRequest, t]);

    const hasProcessingSummaryJob = useMemo(
        () => summaryJobs.some((job) => job.status === "processing"),
        [summaryJobs],
    );

    useEffect(() => {
        const generatingText = t("layout.notebook.summaryGeneratingNotice", "Summary generation started. Please wait.");
        if (hasProcessingSummaryJob) return;
        if (summaryGenerationNotice !== generatingText) return;
        const timer = window.setTimeout(() => {
            setSummaryGenerationNotice(null);
            setSummaryGenerationNoticeTone("info");
        }, 1500);
        return () => window.clearTimeout(timer);
    }, [hasProcessingSummaryJob, summaryGenerationNotice, t]);

    const summaryConfirmHint = useMemo(() => {
        if (!summarySelectedTarget) return t("layout.notebook.summaryHintSelectTarget", "Please select a person or room first.");
        if (!summaryStartDate || !summaryEndDate) return t("layout.notebook.summaryHintSelectTimeRange", "Please select start and end time.");
        if (summaryStartDate > summaryEndDate) return t("layout.notebook.summaryDateRangeInvalid", "Start date must be earlier than or equal to end date.");
        if (isSummaryRangeExceeded(summaryStartDate, summaryEndDate)) {
            return t("layout.notebook.summaryRangeExceeded", "Time range cannot exceed 3 days.");
        }
        return null;
    }, [summaryEndDate, summarySelectedTarget, summaryStartDate, t]);

    const onStartGenerateSummary = useCallback(async (directionPayload?: SummaryDirectionPayload) => {
        if (!hubAccessToken || !summarySelectedTarget || !summaryStartDate || !summaryEndDate) return;
        if (summaryStartDate > summaryEndDate) {
            setSummaryGenerationNotice(t("layout.notebook.summaryDateRangeInvalid", "Start date must be earlier than or equal to end date."));
            setSummaryGenerationNoticeTone("error");
            return;
        }
        if (isSummaryRangeExceeded(summaryStartDate, summaryEndDate)) {
            setSummaryGenerationNotice(t("layout.notebook.summaryRangeExceeded", "Time range cannot exceed 3 days."));
            setSummaryGenerationNoticeTone("error");
            return;
        }
        if (hasProcessingSummaryJob || summaryJobActionBusy) {
            setSummaryGenerationNotice(t("layout.notebook.summaryAlreadyGenerating", "A summary is already generating. Please wait."));
            setSummaryGenerationNoticeTone("error");
            return;
        }
        const roomId = resolveSummaryTargetRoomId(summarySelectedTarget);
        if (!roomId) {
            setSummaryGenerationNotice(t("layout.notebook.summaryRoomResolveFailed", "No shared room found for this target."));
            setSummaryGenerationNoticeTone("error");
            return;
        }
        if (!matrixAccessToken || !matrixHsUrl || !matrixCredentials?.user_id) {
            setSummaryGenerationNotice(t("layout.notebook.summarySearchAuthRequired", "Please sign in again before searching."));
            setSummaryGenerationNoticeTone("error");
            return;
        }

        setSummaryContentLoading(true);
        setSummaryJobActionBusy(true);
        setSummaryGenerationNotice(t("layout.notebook.summaryGeneratingNotice", "Summary generation started. Please wait."));
        setSummaryGenerationNoticeTone("info");
        try {
            const { createChatSummaryJob } = await import("../api/hub");
            const safeTargetLabel = summarySelectedTarget.label.trim() || roomId;
            await runHubSessionRequest((accessToken) => createChatSummaryJob({
                accessToken,
                targetLabel: safeTargetLabel,
                roomId,
                fromDate: summaryStartDate,
                toDate: summaryEndDate,
                summaryDirection: directionPayload?.summaryDirection || "meetingMinutes",
                summaryCustomRequirement: directionPayload?.summaryCustomRequirement || null,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials?.user_id ?? null,
                matrixAccessToken,
            }));
            await loadSummaryJobs();
        } catch (error) {
            const message = error instanceof Error
                ? mapChatSummaryErrorMessage(error.message, t)
                : t("layout.notebook.summaryGenerateFailed", "Failed to start summary generation.");
            setSummaryGenerationNotice(message);
            setSummaryGenerationNoticeTone("error");
        } finally {
            setSummaryContentLoading(false);
            setSummaryJobActionBusy(false);
        }
    }, [
        hubAccessToken,
        summarySelectedTarget,
        summaryStartDate,
        summaryEndDate,
        hasProcessingSummaryJob,
        summaryJobActionBusy,
        resolveSummaryTargetRoomId,
        matrixAccessToken,
        matrixHsUrl,
        matrixCredentials?.user_id,
        loadSummaryJobs,
        runHubSessionRequest,
        t,
    ]);

    const onDeleteSummaryJob = useCallback(async (id: string) => {
        if (!hubAccessToken || !id) return;
        setSummaryJobActionBusy(true);
        try {
            const { deleteChatSummaryJob } = await import("../api/hub");
            await runHubSessionRequest((accessToken) => deleteChatSummaryJob({
                accessToken,
                id,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials?.user_id ?? null,
                matrixAccessToken,
            }));
            await loadSummaryJobs();
        } catch (error) {
            const message = error instanceof Error
                ? mapChatSummaryErrorMessage(error.message, t)
                : t("layout.notebook.summaryDeleteFailed", "Failed to delete summary.");
            setSummaryJobsError(message);
        } finally {
            setSummaryJobActionBusy(false);
        }
    }, [hubAccessToken, loadSummaryJobs, matrixAccessToken, matrixCredentials?.user_id, matrixHsUrl, runHubSessionRequest, t]);

    const onRetrySummaryJob = useCallback(async (id: string) => {
        if (!hubAccessToken || !id) return;
        setSummaryJobActionBusy(true);
        try {
            const { retryChatSummaryJob } = await import("../api/hub");
            await runHubSessionRequest((accessToken) => retryChatSummaryJob({
                accessToken,
                id,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials?.user_id ?? null,
                matrixAccessToken,
            }));
            setSummaryGenerationNotice(t("layout.notebook.summaryRetryStarted", "Retry started."));
            setSummaryGenerationNoticeTone("info");
            await loadSummaryJobs();
        } catch (error) {
            const message = error instanceof Error
                ? mapChatSummaryErrorMessage(error.message, t)
                : t("layout.notebook.summaryRetryFailed", "Failed to retry summary.");
            setSummaryJobsError(message);
        } finally {
            setSummaryJobActionBusy(false);
        }
    }, [hubAccessToken, loadSummaryJobs, matrixAccessToken, matrixCredentials?.user_id, matrixHsUrl, runHubSessionRequest, t]);

    const onDownloadSummaryJob = useCallback(async (job: ChatSummaryJobItem) => {
        if (!hubAccessToken) return;
        setSummaryJobActionBusy(true);
        try {
            const { downloadChatSummaryJob } = await import("../api/hub");
            const blob = await runHubSessionRequest((accessToken) => downloadChatSummaryJob({
                accessToken,
                id: job.id,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials?.user_id ?? null,
                matrixAccessToken,
            }));
            const compactStart = toCompactDateTime(job.from_date);
            const compactEnd = toCompactDateTime(job.to_date);
            const fileBase = `${job.target_label}聊天室总结${compactStart}${compactEnd}`.replace(/[\\/:*?"<>|]/g, "_");
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${fileBase || "chat-summary"}.docx`;
            anchor.rel = "noopener noreferrer";
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
        } catch (error) {
            const message = error instanceof Error
                ? mapChatSummaryErrorMessage(error.message, t)
                : t("layout.notebook.summaryDownloadFailed", "Failed to download summary.");
            setSummaryJobsError(message);
        } finally {
            setSummaryJobActionBusy(false);
        }
    }, [hubAccessToken, matrixAccessToken, matrixCredentials?.user_id, matrixHsUrl, runHubSessionRequest, t]);

    const onPreviewSummaryJob = useCallback(async (job: ChatSummaryJobItem) => {
        if (!hubAccessToken || !job?.id) return;
        setSummaryPreviewLoading(true);
        setSummaryPreviewError(null);
        try {
            const { getChatSummaryJob } = await import("../api/hub");
            const detail = await runHubSessionRequest((accessToken) => getChatSummaryJob({
                accessToken,
                id: job.id,
                hsUrl: matrixHsUrl,
                matrixUserId: matrixCredentials?.user_id ?? null,
                matrixAccessToken,
            }));
            setSummaryPreviewJob(detail);
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            const shouldFallbackToDownload = /Cannot GET \/chat\/summary\/jobs\//i.test(message)
                || /404/.test(message);
            if (shouldFallbackToDownload) {
                try {
                    const { downloadChatSummaryJob } = await import("../api/hub");
                    const blob = await runHubSessionRequest((accessToken) => downloadChatSummaryJob({
                        accessToken,
                        id: job.id,
                        hsUrl: matrixHsUrl,
                        matrixUserId: matrixCredentials?.user_id ?? null,
                        matrixAccessToken,
                    }));
                    const summaryText = await blob.text();
                    setSummaryPreviewJob({
                        id: job.id,
                        target_label: job.target_label,
                        room_id: job.room_id,
                        from_date: job.from_date,
                        to_date: job.to_date,
                        status: job.status,
                        created_at: job.created_at,
                        updated_at: job.updated_at,
                        summary_text: summaryText,
                    });
                } catch (fallbackError) {
                    const fallbackMessage = fallbackError instanceof Error
                        ? mapChatSummaryErrorMessage(fallbackError.message, t)
                        : t("layout.notebook.summaryPreviewFailed", "Failed to load summary preview.");
                    setSummaryPreviewError(fallbackMessage);
                    setSummaryPreviewJob(null);
                }
            } else {
                setSummaryPreviewError(
                    mapChatSummaryErrorMessage(
                        message || t("layout.notebook.summaryPreviewFailed", "Failed to load summary preview."),
                        t,
                    ),
                );
                setSummaryPreviewJob(null);
            }
        } finally {
            setSummaryPreviewLoading(false);
        }
    }, [hubAccessToken, matrixAccessToken, matrixCredentials?.user_id, matrixHsUrl, runHubSessionRequest, t]);

    // Load summary jobs when switching to chatSummary tab
    useEffect(() => {
        if (activeTab !== "notebook" || notebookSidebarMode !== "chatSummary") return;
        void loadSummaryJobs();
    }, [activeTab, notebookSidebarMode, loadSummaryJobs]);

    // Poll for processing summary jobs
    useEffect(() => {
        if (activeTab !== "notebook" || notebookSidebarMode !== "chatSummary") return;
        if (!hasProcessingSummaryJob) return;
        const timer = window.setInterval(() => {
            void loadSummaryJobs({ background: true });
        }, 2500);
        return () => window.clearInterval(timer);
    }, [activeTab, hasProcessingSummaryJob, loadSummaryJobs, notebookSidebarMode]);

    // -- Summary workspace panel (job list / preview) --
    const summaryWorkspacePanel = (
        <div className="mx-auto w-full min-w-0 max-w-none">
            <div className="mb-4 text-base font-semibold text-slate-800 dark:text-slate-100">
                {t("layout.notebook.summaryWorkspaceTitle", "Chat Summary")}
                {summaryJobsRefreshing ? (
                    <span className="ml-2 text-xs font-medium text-slate-400 dark:text-slate-500">
                        {t("layout.notebook.summaryRefreshing", "Refreshing...")}
                    </span>
                ) : null}
            </div>
            {summaryGenerationNotice ? (
                <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-semibold ${
                    summaryGenerationNoticeTone === "error"
                        ? "border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200"
                        : "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200"
                }`}>
                    {summaryGenerationNotice}
                </div>
            ) : null}
            {summaryJobsError ? (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-500 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                    {summaryJobsError}
                </div>
            ) : null}
            {summaryPreviewJob ? (
                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={() => setSummaryPreviewJob(null)}
                        className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-300"
                    >
                        {t("layout.notebook.summaryBackToList", "Back to summary list")}
                    </button>
                    <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {`${summaryPreviewJob.target_label}${t("layout.notebook.summaryJobNameSuffix", "聊天室总结")}`}
                        </div>
                        <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                            {`${formatSummaryDisplayDateTime(summaryPreviewJob.from_date)} ~ ${formatSummaryDisplayDateTime(summaryPreviewJob.to_date)}`}
                        </div>
                        <div className="max-h-[56vh] max-w-full overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 px-3 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                            <Suspense fallback={<div className="text-sm text-slate-500 dark:text-slate-400">Loading summary preview...</div>}>
                                <NotebookSummaryMarkdown content={summaryPreviewJob.summary_text || ""} />
                            </Suspense>
                        </div>
                    </div>
                </div>
            ) : summaryJobsLoading && summaryJobs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    {t("layout.notebook.summaryJobsLoading", "Loading summary list...")}
                </div>
            ) : summaryJobs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                    {t("layout.notebook.summaryJobsEmpty", "No generated summary yet.")}
                </div>
            ) : (
                <div className="space-y-2">
                    {summaryPreviewError ? (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-500 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                            {summaryPreviewError}
                        </div>
                    ) : null}
                    {summaryJobs.map((job) => (
                        <div
                            key={job.id}
                            className="rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900"
                        >
                            <div className="mb-1 flex items-center justify-between gap-3">
                                    <div className="min-w-0 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                                        {`${job.target_label}${t("layout.notebook.summaryJobNameSuffix", "聊天室总结")}`}
                                    </div>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    job.status === "completed"
                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                                        : job.status === "failed"
                                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200"
                                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                                }`}>
                                    {job.status === "completed"
                                        ? t("layout.notebook.summaryStatusCompleted", "Completed")
                                        : job.status === "failed"
                                            ? t("layout.notebook.summaryStatusFailed", "Failed")
                                            : t("layout.notebook.summaryStatusProcessing", "Processing")}
                                </span>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                {`${formatSummaryDisplayDateTime(job.from_date)} ~ ${formatSummaryDisplayDateTime(job.to_date)}`}
                            </div>
                            {job.status === "processing" ? (
                                <div className="mt-2 space-y-1">
                                    <div className="break-words text-xs text-slate-600 dark:text-slate-300">
                                        {job.progress_message || t("layout.notebook.summaryStatusProcessing", "Processing")}
                                        {Number.isFinite(Number(job.progress_current)) && Number.isFinite(Number(job.progress_total)) && Number(job.progress_total) > 0
                                            ? ` (${Number(job.progress_current)}/${Number(job.progress_total)})`
                                            : ""}
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                                        <div
                                            className="h-full bg-emerald-500 transition-all"
                                            style={{
                                                width: (() => {
                                                    const current = Number(job.progress_current);
                                                    const total = Number(job.progress_total);
                                                    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return "18%";
                                                    const percent = Math.max(4, Math.min(100, Math.round((current / total) * 100)));
                                                    return `${percent}%`;
                                                })(),
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : null}
                            {job.status === "failed" ? (
                                <div className="mt-1 break-words text-xs text-rose-500 dark:text-rose-300">
                                    {job.progress_message || job.error_message || t("layout.notebook.summaryGenerateFailed", "Failed to start summary generation.")}
                                </div>
                            ) : null}
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {t("layout.notebook.summaryGeneratedDate", {
                                    date: formatSummaryDisplayDate(job.created_at),
                                    defaultValue: "Generated on: {{date}}",
                                })}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={summaryPreviewLoading || job.status !== "completed" || !job.has_content}
                                    onClick={() => void onPreviewSummaryJob(job)}
                                    className="rounded-md border border-slate-400 px-2 py-1 text-xs font-semibold text-slate-600 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-500 dark:text-slate-200 dark:enabled:hover:bg-slate-800"
                                >
                                    {t("layout.notebook.summaryPreview", "Preview")}
                                </button>
                                <button
                                    type="button"
                                    disabled={summaryJobActionBusy || job.status !== "completed" || !job.has_content}
                                    onClick={() => void onDownloadSummaryJob(job)}
                                    className="rounded-md border border-emerald-500 px-2 py-1 text-xs font-semibold text-emerald-700 enabled:hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-400 dark:text-emerald-300 dark:enabled:hover:bg-emerald-900/20"
                                >
                                    {t("layout.notebook.summaryDownload", "Download")}
                                </button>
                                <button
                                    type="button"
                                    disabled={summaryJobActionBusy || hasProcessingSummaryJob || job.status !== "failed"}
                                    onClick={() => void onRetrySummaryJob(job.id)}
                                    className="rounded-md border border-amber-400 px-2 py-1 text-xs font-semibold text-amber-600 enabled:hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-400 dark:text-amber-300 dark:enabled:hover:bg-amber-900/20"
                                >
                                    {t("layout.notebook.summaryRetry", "Retry")}
                                </button>
                                <button
                                    type="button"
                                    disabled={summaryJobActionBusy}
                                    onClick={() => void onDeleteSummaryJob(job.id)}
                                    className="rounded-md border border-rose-400 px-2 py-1 text-xs font-semibold text-rose-600 enabled:hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-400 dark:text-rose-300 dark:enabled:hover:bg-rose-900/20"
                                >
                                    {t("layout.notebook.summaryDelete", "Delete")}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <Suspense fallback={fallback}>
            <NotebookWorkspaceDesktop
                auth={auth}
                enabled={enabled}
                refreshToken={refreshToken}
                onAuthFailure={onAuthFailure}
                onTerminalAuthFailure={onTerminalAuthFailure}
                workspaceAvailable={workspaceAvailable}
                userType={userType}
                sidebarMode={notebookSidebarMode}
                onSidebarModeChange={setNotebookSidebarMode}
                summaryQuery={summarySearchQuery}
                onSummaryQueryChange={setSummarySearchQuery}
                onSummarySearchNow={setDebouncedSummarySearchQuery}
                summaryLoading={summarySearchLoading}
                summaryError={summarySearchError}
                summaryPeopleResults={summaryPeopleResults}
                summaryRoomResults={summaryRoomResults}
                summarySelectedTarget={summarySelectedTarget}
                onSummarySelectTarget={setSummarySelectedTarget}
                summaryStartDate={summaryStartDate}
                summaryEndDate={summaryEndDate}
                onSummaryStartDateChange={setSummaryStartDate}
                onSummaryEndDateChange={setSummaryEndDate}
                onSummaryConfirm={onStartGenerateSummary}
                summaryConfirmLoading={summaryContentLoading}
                summaryConfirmHint={summaryConfirmHint}
                summaryWorkspacePanel={summaryWorkspacePanel}
                matrixClient={matrixClient}
                matrixAccessToken={matrixCredentials?.access_token ?? null}
                uploadLimitMb={uploadLimitMb}
                pushToast={pushToast}
                onOpenPreview={onOpenPreview}
            />
        </Suspense>
    );
};
