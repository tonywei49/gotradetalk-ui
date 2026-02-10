import { useEffect, useState } from "react";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { ClientEvent, RoomEvent } from "matrix-js-sdk";

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

        const bindRoom = (): void => {
            const activeRoom = client.getRoom(roomId) ?? null;
            setRoom(activeRoom);
            if (!activeRoom) return;
            const initialEvents = activeRoom.getLiveTimeline().getEvents();
            setEvents(limit ? initialEvents.slice(-limit) : [...initialEvents]);
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
            setRoom(resetRoom);
            const resetEvents = resetRoom.getLiveTimeline().getEvents();
            setEvents(limit ? resetEvents.slice(-limit) : [...resetEvents]);
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
    }, [client, roomId, limit]);

    return { events, room };
}
