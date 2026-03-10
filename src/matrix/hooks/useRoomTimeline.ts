import { useEffect, useMemo, useState } from "react";
import { ClientEvent, MatrixEvent, RoomEvent } from "matrix-js-sdk";
import type { MatrixClient, Room } from "matrix-js-sdk";

type UseRoomTimelineOptions = {
    limit?: number;
};

type UseRoomTimelineResult = {
    events: MatrixEvent[];
    room: Room | null;
    showingCachedEvents: boolean;
};

const ROOM_TIMELINE_CACHE_PREFIX = "gtt_room_timeline_cache_v1:";

function buildRoomTimelineCacheKey(client: MatrixClient | null, roomId: string | null): string | null {
    const userId = client?.getUserId() ?? "";
    if (!userId || !roomId) return null;
    return `${ROOM_TIMELINE_CACHE_PREFIX}${userId}:${roomId}`;
}

function readCachedTimeline(cacheKey: string | null): MatrixEvent[] {
    if (!cacheKey || typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as object[];
        if (!Array.isArray(parsed)) return [];
        return parsed.map((event) => new MatrixEvent(event as any));
    } catch {
        return [];
    }
}

function writeCachedTimeline(cacheKey: string | null, events: MatrixEvent[], limit?: number): void {
    if (!cacheKey || typeof window === "undefined") return;
    try {
        const trimmed = limit ? events.slice(-limit) : events;
        const payload = trimmed.map((event) => event.toJSON());
        localStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch {
        // ignore cache write failures
    }
}

export function useRoomTimeline(
    client: MatrixClient | null,
    roomId: string | null,
    options: UseRoomTimelineOptions = {},
): UseRoomTimelineResult {
    const [events, setEvents] = useState<MatrixEvent[]>([]);
    const [room, setRoom] = useState<Room | null>(null);
    const [showingCachedEvents, setShowingCachedEvents] = useState(false);
    const limit = options.limit;
    const cacheKey = useMemo(() => buildRoomTimelineCacheKey(client, roomId), [client, roomId]);

    useEffect(() => {
        if (!client || !roomId) {
            setEvents([]);
            setRoom(null);
            setShowingCachedEvents(false);
            return undefined;
        }

        const cachedEvents = readCachedTimeline(cacheKey);
        let usedCachedEvents = false;
        if (cachedEvents.length > 0) {
            usedCachedEvents = true;
            setEvents(limit ? cachedEvents.slice(-limit) : cachedEvents);
            setShowingCachedEvents(true);
        } else {
            setShowingCachedEvents(false);
        }

        const bindRoom = (): void => {
            const activeRoom = client.getRoom(roomId) ?? null;
            setRoom(activeRoom);
            if (!activeRoom) return;
            const initialEvents = activeRoom.getLiveTimeline().getEvents();
            if (initialEvents.length === 0 && usedCachedEvents) return;
            const nextEvents = limit ? initialEvents.slice(-limit) : [...initialEvents];
            setEvents(nextEvents);
            setShowingCachedEvents(false);
            writeCachedTimeline(cacheKey, nextEvents, limit);
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
            setRoom(timelineRoom);
            setShowingCachedEvents(false);

            setEvents((prev) => {
                const eventId = event.getId();
                if (eventId && prev.some((item) => item.getId() === eventId)) {
                    return prev;
                }
                const next = toStartOfTimeline ? [event, ...prev] : [...prev, event];
                const trimmed = !limit ? next : toStartOfTimeline ? next.slice(0, limit) : next.slice(-limit);
                writeCachedTimeline(cacheKey, trimmed, limit);
                return trimmed;
            });
        };

        const onReset = (resetRoom: Room | undefined): void => {
            if (!resetRoom || resetRoom.roomId !== roomId) return;
            setRoom(resetRoom);
            const resetEvents = resetRoom.getLiveTimeline().getEvents();
            const nextEvents = limit ? resetEvents.slice(-limit) : [...resetEvents];
            setEvents(nextEvents);
            setShowingCachedEvents(false);
            writeCachedTimeline(cacheKey, nextEvents, limit);
        };

        const onRoom = (updatedRoom: Room | undefined): void => {
            if (!updatedRoom || updatedRoom.roomId !== roomId) return;
            bindRoom();
        };

        const onMembership = (updatedMemberRoom: Room, _membership: string, _prevMembership?: string): void => {
            if (!updatedMemberRoom || updatedMemberRoom.roomId !== roomId) return;
            bindRoom();
        };

        const onSync = (): void => {
            if (!client.getRoom(roomId)) return;
            bindRoom();
        };

        client.on(RoomEvent.Timeline, onTimeline);
        client.on(RoomEvent.TimelineReset, onReset);
        client.on("Room" as any, onRoom);
        client.on(RoomEvent.MyMembership, onMembership);
        client.on(ClientEvent.Sync, onSync);

        return () => {
            client.off(RoomEvent.Timeline, onTimeline);
            client.off(RoomEvent.TimelineReset, onReset);
            client.off("Room" as any, onRoom);
            client.off(RoomEvent.MyMembership, onMembership);
            client.off(ClientEvent.Sync, onSync);
        };
    }, [cacheKey, client, roomId, limit]);

    return { events, room, showingCachedEvents };
}
