import type { MatrixClient, ICreateRoomOpts } from "matrix-js-sdk";
import { Preset, Visibility } from "matrix-js-sdk";
import { ROOM_KIND_EVENT, ROOM_KIND_GROUP } from "../constants/roomKinds";

export type HistoryVisibility = "shared" | "joined";

export interface CreateGroupChatOptions {
    name: string;
    invitees: string[];
    historyVisibility: HistoryVisibility;
    topic?: string;
}

/**
 * 鍓靛缓缇ょ祫鑱婂ぉ鎴块枔銆?
 * 
 * @param client Matrix 瀹㈡埗绔?
 * @param options 鍓靛缓閬搁爡
 * @returns 鏂板壍寤虹殑鎴块枔 ID
 */
export async function createGroupChat(
    client: MatrixClient,
    options: CreateGroupChatOptions
): Promise<string> {
    const { name, invitees, historyVisibility, topic } = options;
    const userId = client.getUserId();

    if (!userId) {
        throw new Error("User is not logged in");
    }

    // 妲嬪缓 initial_state 瑷疆姝峰彶鍙鎬с€佸姞鍏ヨ鍓囥€佽í瀹㈣í鍟?
    const initialState: ICreateRoomOpts["initial_state"] = [
        {
            type: ROOM_KIND_EVENT,
            state_key: "",
            content: { kind: ROOM_KIND_GROUP },
        },
        {
            type: "m.room.history_visibility",
            state_key: "",
            content: {
                history_visibility: historyVisibility,
            },
        },
        {
            type: "m.room.join_rules",
            state_key: "",
            content: {
                join_rule: "invite", // 鍙湁鍙楅個鑰呮墠鑳藉姞鍏?
            },
        },
        {
            type: "m.room.guest_access",
            state_key: "",
            content: {
                guest_access: "forbidden", // 绂佹瑷瑷晱
            },
        },
    ];

    // 妲嬪缓 power_level_content_override 纰轰繚鍓靛缓鑰呮槸绠＄悊鍝?
    const powerLevelContentOverride = {
        users: {
            [userId]: 100, // 鍓靛缓鑰呮搧鏈夋渶楂樻瑠闄?
        },
        users_default: 0,
        events_default: 0,
        state_default: 50,
        ban: 50,
        kick: 50,
        redact: 50,
        invite: 50,
    };

    // 鍓靛缓鎴块枔閰嶇疆 - 涓嶅湪鍓靛缓鏅傞個璜嬶紝寰岀簩閫愪竴閭€璜嬩互瑙ｆ焙 Federation 鍟忛
    const createRoomOpts: ICreateRoomOpts = {
        name,
        topic,
        preset: Preset.PrivateChat, // 绉佹湁缇ょ祫锛屼笉鏈冭嚜鍕曢枊鍟熷姞瀵?
        visibility: Visibility.Private, // 涓嶅叕闁嬪湪鐩寗涓?
        // 娉ㄦ剰锛氫笉浣跨敤 invite 鍙冩暩锛屽洜鐐鸿法鏈嶅嫏鍣ㄥ彲鑳藉皫鑷撮個璜嬪け鏁?
        initial_state: initialState,
        power_level_content_override: powerLevelContentOverride,
    };
    const result = await client.createRoom(createRoomOpts);
    const roomId = result.room_id;

    // 纰轰繚鎴块枔涓嶅湪鐩寗涓彲瑕?
    await client.setRoomDirectoryVisibility(roomId, Visibility.Private);

    // 閫愪竴閭€璜嬬敤鎴讹紝纰轰繚璺ㄦ湇鍕欏櫒閭€璜嬫纰虹櫦閫?
    if (invitees.length > 0) {
        const failures: string[] = [];
        for (const invitee of invitees) {
            try {
                await client.invite(roomId, invitee);
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : typeof error === "string"
                            ? error
                            : "Invite failed";
                failures.push(`${invitee}: ${message}`);
            }
        }
        if (failures.length > 0) {
            throw new Error(`Invite failed: ${failures.join("; ")}`);
        }
        const inviteStatus = await waitForInviteState(client, roomId, invitees, 8000);
        if (inviteStatus.missing.length > 0) {
            throw new Error(`Invite not delivered: ${inviteStatus.missing.join(", ")}`);
        }
    }

    return roomId;
}

async function waitForInviteState(
    client: MatrixClient,
    roomId: string,
    invitees: string[],
    timeoutMs: number
): Promise<{ missing: string[] }> {
    const start = Date.now();
    const pending = new Set(invitees);
    while (pending.size > 0 && Date.now() - start < timeoutMs) {
        const room = client.getRoom(roomId);
        if (room) {
            for (const userId of Array.from(pending)) {
                const membership = room.getMember(userId)?.membership;
                if (membership === "invite" || membership === "join") {
                    pending.delete(userId);
                }
            }
        }
        if (pending.size === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { missing: Array.from(pending) };
}

