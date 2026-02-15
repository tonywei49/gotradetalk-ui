import { EventType, MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

export async function sendTextMessageEvent(
    matrixClient: MatrixClient,
    roomId: string,
    body: string,
): Promise<string | undefined> {
    const result = (await matrixClient.sendEvent(roomId, EventType.RoomMessage, {
        msgtype: MsgType.Text,
        body,
    })) as { event_id?: string } | undefined;
    return result?.event_id;
}

export async function sendNoticeMessageEvent(
    matrixClient: MatrixClient,
    roomId: string,
    body: string,
): Promise<void> {
    await matrixClient.sendEvent(roomId, EventType.RoomMessage, {
        msgtype: MsgType.Notice,
        body,
    } as never);
}

export async function sendFileMessageEvent(
    matrixClient: MatrixClient,
    roomId: string,
    content: Record<string, unknown>,
): Promise<void> {
    await matrixClient.sendEvent(roomId, EventType.RoomMessage, content as never);
}

export async function resendMessageEvent(
    matrixClient: MatrixClient,
    event: MatrixEvent,
    room: Room,
): Promise<void> {
    await matrixClient.resendEvent(event, room);
}

export async function redactMessageEvent(
    matrixClient: MatrixClient,
    roomId: string,
    eventId: string,
): Promise<void> {
    await matrixClient.redactEvent(roomId, eventId);
}

export async function sendReadReceiptEvent(
    matrixClient: MatrixClient,
    event: MatrixEvent,
): Promise<void> {
    await matrixClient.sendReadReceipt(event);
}

export async function scrollbackTimeline(
    matrixClient: MatrixClient,
    room: Room,
    limit: number,
): Promise<void> {
    await matrixClient.scrollback(room, limit);
}
