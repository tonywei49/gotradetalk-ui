import { useEffect, useState } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { RoomEvent } from "matrix-js-sdk";

type UseRoomTimelineOptions = {
    limit?: number;
};

type UseRoomTimelineResult = {
    events: MatrixEvent[];
    room: Room | null;
};

export function useRoomTimeline(
    client: MatrixClient | null,
    roomId: string | null,
    options: UseRoomTimelineOptions = {},
): UseRoomTimelineResult {
    const [events, setEvents] = useState<MatrixEvent[]>([]);
    const [room, setRoom] = useState<Room | null>(null);
    const limit = options.limit;

    useEffect(() => {
        if (!client || !roomId) {
            setEvents([]);
            setRoom(null);
            return undefined;
        }

        const activeRoom = client.getRoom(roomId) ?? null;
        setRoom(activeRoom);

        if (activeRoom) {
            const initialEvents = activeRoom.getLiveTimeline().getEvents();
            setEvents(limit ? initialEvents.slice(-limit) : [...initialEvents]);
        } else {
            setEvents([]);
        }

        const onTimeline = (
            event: MatrixEvent,
            timelineRoom: Room | undefined,
            toStartOfTimeline: boolean | undefined,
            removed: boolean,
        ): void => {
            if (!timelineRoom || timelineRoom.roomId !== roomId) return;
            if (removed) return;

            setEvents((prev) => {
                const eventId = event.getId();
                if (eventId && prev.some((item) => item.getId() === eventId)) {
                    return prev;
                }
                const next = toStartOfTimeline ? [event, ...prev] : [...prev, event];
                if (!limit) return next;
                return toStartOfTimeline ? next.slice(0, limit) : next.slice(-limit);
            });
        };

        const onReset = (resetRoom: Room | undefined): void => {
            if (!resetRoom || resetRoom.roomId !== roomId) return;
            const resetEvents = resetRoom.getLiveTimeline().getEvents();
            setEvents(limit ? resetEvents.slice(-limit) : [...resetEvents]);
        };

        client.on(RoomEvent.Timeline, onTimeline);
        client.on(RoomEvent.TimelineReset, onReset);

        return () => {
            client.off(RoomEvent.Timeline, onTimeline);
            client.off(RoomEvent.TimelineReset, onReset);
        };
    }, [client, roomId, limit]);

    return { events, room };
}
