import { useEffect, useMemo, useRef, useState } from "react";
import { ClientEvent, MatrixEvent, RoomEvent } from "matrix-js-sdk";
import type { MatrixClient, Room } from "matrix-js-sdk";
import {
    readRoomTimelineCacheFromSqlite,
    writeRoomTimelineCacheToSqlite,
} from "../../desktop/desktopCacheDb";
import { isTauriDesktop, resolveRuntimePlatform } from "../../runtime/appRuntime";

type UseRoomTimelineOptions = {
    limit?: number;
};

type UseRoomTimelineResult = {
    events: MatrixEvent[];
    room: Room | null;
    showingCachedEvents: boolean;
};

const IS_WINDOWS_DESKTOP = isTauriDesktop() && resolveRuntimePlatform() === "windows";

const ROOM_TIMELINE_CACHE_PREFIX = "gtt_room_timeline_cache_v2:";
const ROOM_TIMELINE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ROOM_TIMELINE_PERSIST_LIMIT = IS_WINDOWS_DESKTOP ? 60 : 120;
const ROOM_LIVE_EVENT_WINDOW_LIMIT = IS_WINDOWS_DESKTOP ? 30 : 60;

type SerializedRoomTimelineCache = {
    version: 2;
    roomId: string;
    events: object[];
};

function buildRoomTimelineCacheKey(client: MatrixClient | null, roomId: string | null): string | null {
    const userId = client?.getUserId() ?? "";
    if (!userId || !roomId) return null;
    return `${ROOM_TIMELINE_CACHE_PREFIX}${userId}:${roomId}`;
}

function readCachedTimeline(cacheKey: string | null, roomId: string): MatrixEvent[] {
    if (!cacheKey || typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as SerializedRoomTimelineCache;
        if (!parsed || parsed.version !== 2 || parsed.roomId !== roomId || !Array.isArray(parsed.events)) return [];
        return parsed.events.map((event) => new MatrixEvent(event as any));
    } catch {
        return [];
    }
}

function writeCachedTimeline(cacheKey: string | null, roomId: string, events: MatrixEvent[], limit?: number): void {
    if (!cacheKey || typeof window === "undefined") return;
    try {
        const effectiveLimit = limit ? Math.max(limit, ROOM_TIMELINE_PERSIST_LIMIT) : ROOM_TIMELINE_PERSIST_LIMIT;
        const trimmed = events.slice(-effectiveLimit);
        const payload: SerializedRoomTimelineCache = {
            version: 2,
            roomId,
            events: trimmed.map((event) => event.toJSON()),
        };
        localStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch {
        // ignore cache write failures
    }
}

function serializeTimeline(roomId: string, events: MatrixEvent[], limit?: number): SerializedRoomTimelineCache {
    const effectiveLimit = limit ? Math.max(limit, ROOM_TIMELINE_PERSIST_LIMIT) : ROOM_TIMELINE_PERSIST_LIMIT;
    const trimmed = events.slice(-effectiveLimit);
    return {
        version: 2,
        roomId,
        events: trimmed.map((event) => event.toJSON()),
    };
}

function deserializeTimeline(payload: SerializedRoomTimelineCache | null | undefined, roomId: string): MatrixEvent[] {
    if (!payload || payload.version !== 2 || payload.roomId !== roomId || !Array.isArray(payload.events)) return [];
    return payload.events.map((event) => new MatrixEvent(event as never));
}

function filterEventsForRoom(events: MatrixEvent[], roomId: string, limit?: number): MatrixEvent[] {
    const filtered = events.filter((event) => {
        const eventRoomId = event.getRoomId();
        return !eventRoomId || eventRoomId === roomId;
    });
    return limit ? filtered.slice(-limit) : filtered;
}

function mergeRoomEvents(roomId: string, ...groups: MatrixEvent[][]): MatrixEvent[] {
    const merged: MatrixEvent[] = [];
    const seenEventIds = new Set<string>();
    for (const group of groups) {
        for (const event of group) {
            const eventRoomId = event.getRoomId();
            if (eventRoomId && eventRoomId !== roomId) continue;
            const eventId = event.getId();
            if (eventId) {
                if (seenEventIds.has(eventId)) continue;
                seenEventIds.add(eventId);
            }
            merged.push(event);
        }
    }
    return merged;
}

function getEventStableKey(event: MatrixEvent): string {
    return event.getId() ?? event.getTxnId() ?? `${event.getTs()}-${event.getSender() ?? "unknown"}`;
}

function haveSameEventSequence(a: MatrixEvent[], b: MatrixEvent[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
        if (getEventStableKey(a[index]) !== getEventStableKey(b[index])) {
            return false;
        }
    }
    return true;
}

export function useRoomTimeline(
    client: MatrixClient | null,
    roomId: string | null,
    options: UseRoomTimelineOptions = {},
): UseRoomTimelineResult {
    const [events, setEvents] = useState<MatrixEvent[]>([]);
    const [room, setRoom] = useState<Room | null>(null);
    const [showingCachedEvents, setShowingCachedEvents] = useState(false);
    const roomGenerationRef = useRef(0);
    const limit = options.limit;
    const cacheKey = useMemo(() => buildRoomTimelineCacheKey(client, roomId), [client, roomId]);
    const cacheUserId = useMemo(() => client?.getUserId() ?? null, [client]);
    const historyExpandedRef = useRef(false);

    useEffect(() => {
        if (!client || !roomId) {
            roomGenerationRef.current += 1;
            setEvents([]);
            setRoom(null);
            setShowingCachedEvents(false);
            return undefined;
        }

        roomGenerationRef.current += 1;
        historyExpandedRef.current = false;
        const generation = roomGenerationRef.current;
        const isCurrentRoom = (): boolean => roomGenerationRef.current === generation;
        const trimLiveWindow = (items: MatrixEvent[]): MatrixEvent[] => {
            if (historyExpandedRef.current) {
                return items;
            }
            const effectiveLimit = limit ? Math.max(limit, ROOM_LIVE_EVENT_WINDOW_LIMIT) : ROOM_LIVE_EVENT_WINDOW_LIMIT;
            return items.slice(-effectiveLimit);
        };

        // Reset room-scoped state immediately when switching rooms so we never
        // render the previous room's timeline under the new room header.
        setEvents([]);
        setRoom(client.getRoom(roomId) ?? null);
        setShowingCachedEvents(false);

        const cachedEvents = readCachedTimeline(cacheKey, roomId);
        let disposed = false;
        let usedCachedEvents = false;
        const roomCachedEvents = filterEventsForRoom(cachedEvents, roomId, limit);
        if (roomCachedEvents.length > 0) {
            usedCachedEvents = true;
            setEvents(roomCachedEvents);
            setShowingCachedEvents(true);
        } else {
            setShowingCachedEvents(false);
        }

        void readRoomTimelineCacheFromSqlite<SerializedRoomTimelineCache>(cacheUserId, roomId, ROOM_TIMELINE_CACHE_TTL_MS)
            .then((payload) => {
                if (disposed || !isCurrentRoom()) return;
                const sqliteEvents = filterEventsForRoom(deserializeTimeline(payload, roomId), roomId, limit);
                if (sqliteEvents.length === 0) return;
                usedCachedEvents = true;
                setEvents(sqliteEvents);
                setShowingCachedEvents(true);
            })
            .catch(() => undefined);

        const bindRoom = (): void => {
            if (!isCurrentRoom()) return;
            const activeRoom = client.getRoom(roomId) ?? null;
            setRoom(activeRoom);
            if (!activeRoom) return;
            const liveEvents = filterEventsForRoom(activeRoom.getLiveTimeline().getEvents(), roomId);
            const initialEvents = limit ? liveEvents.slice(-limit) : liveEvents;
            if (initialEvents.length === 0 && usedCachedEvents) return;
            setShowingCachedEvents(false);
            setEvents((prev) => {
                const base = prev.length > 0 ? prev : initialEvents;
                const snapshot = prev.length > 0
                    ? trimLiveWindow(mergeRoomEvents(roomId, prev, liveEvents))
                    : trimLiveWindow([...base]);
                if (haveSameEventSequence(prev, snapshot)) {
                    return prev;
                }
                writeCachedTimeline(cacheKey, roomId, snapshot, limit);
                void writeRoomTimelineCacheToSqlite(cacheUserId, roomId, serializeTimeline(roomId, snapshot, limit));
                return snapshot;
            });
        };

        bindRoom();

        const onTimeline = (
            event: MatrixEvent,
            timelineRoom: Room | undefined,
            toStartOfTimeline: boolean | undefined,
            removed: boolean,
        ): void => {
            if (!timelineRoom || timelineRoom.roomId !== roomId) return;
            if (removed) return;
            if (!isCurrentRoom()) return;
            setRoom(timelineRoom);
            setShowingCachedEvents(false);
            if (toStartOfTimeline) {
                historyExpandedRef.current = true;
            }

            setEvents((prev) => {
                const eventId = event.getId();
                if (eventId && prev.some((item) => item.getId() === eventId)) {
                    return prev;
                }
                const next = trimLiveWindow(
                    filterEventsForRoom(toStartOfTimeline ? [event, ...prev] : [...prev, event], roomId),
                );
                if (haveSameEventSequence(prev, next)) {
                    return prev;
                }
                writeCachedTimeline(cacheKey, roomId, next, limit);
                void writeRoomTimelineCacheToSqlite(cacheUserId, roomId, serializeTimeline(roomId, next, limit));
                return next;
            });
        };

        const onReset = (resetRoom: Room | undefined): void => {
            if (!resetRoom || resetRoom.roomId !== roomId) return;
            if (!isCurrentRoom()) return;
            setRoom(resetRoom);
            setShowingCachedEvents(false);
            setEvents((prev) => {
                const liveEvents = filterEventsForRoom(resetRoom.getLiveTimeline().getEvents(), roomId);
                const snapshot = prev.length > 0
                    ? trimLiveWindow(mergeRoomEvents(roomId, prev, liveEvents))
                    : trimLiveWindow(limit ? liveEvents.slice(-limit) : liveEvents);
                if (haveSameEventSequence(prev, snapshot)) {
                    return prev;
                }
                writeCachedTimeline(cacheKey, roomId, snapshot, limit);
                void writeRoomTimelineCacheToSqlite(cacheUserId, roomId, serializeTimeline(roomId, snapshot, limit));
                return snapshot;
            });
        };

        const onRoom = (updatedRoom: Room | undefined): void => {
            if (!updatedRoom || updatedRoom.roomId !== roomId) return;
            if (!isCurrentRoom()) return;
            bindRoom();
        };

        const onMembership = (updatedMemberRoom: Room, _membership: string, _prevMembership?: string): void => {
            if (!updatedMemberRoom || updatedMemberRoom.roomId !== roomId) return;
            if (!isCurrentRoom()) return;
            bindRoom();
        };

        const onSync = (): void => {
            if (!isCurrentRoom()) return;
            if (!client.getRoom(roomId)) return;
            bindRoom();
        };

        client.on(RoomEvent.Timeline, onTimeline);
        client.on(RoomEvent.TimelineReset, onReset);
        client.on("Room" as any, onRoom);
        client.on(RoomEvent.MyMembership, onMembership);
        client.on(ClientEvent.Sync, onSync);

        return () => {
            disposed = true;
            client.off(RoomEvent.Timeline, onTimeline);
            client.off(RoomEvent.TimelineReset, onReset);
            client.off("Room" as any, onRoom);
            client.off(RoomEvent.MyMembership, onMembership);
            client.off(ClientEvent.Sync, onSync);
        };
    }, [cacheKey, cacheUserId, client, roomId, limit]);

    return { events, room, showingCachedEvents };
}
