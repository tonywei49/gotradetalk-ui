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
 * 創建群組聊天房間。
 * 
 * @param client Matrix 客戶端
 * @param options 創建選項
 * @returns 新創建的房間 ID
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

    // 構建 initial_state 設置歷史可見性、加入規則、訪客訪問
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
                join_rule: "invite", // 只有受邀者才能加入
            },
        },
        {
            type: "m.room.guest_access",
            state_key: "",
            content: {
                guest_access: "forbidden", // 禁止訪客訪問
            },
        },
    ];

    // 構建 power_level_content_override 確保創建者是管理員
    const powerLevelContentOverride = {
        users: {
            [userId]: 100, // 創建者擁有最高權限
        },
        users_default: 0,
        events_default: 0,
        state_default: 50,
        ban: 50,
        kick: 50,
        redact: 50,
        invite: 50,
    };

    // 創建房間配置 - 不在創建時邀請，後續逐一邀請以解決 Federation 問題
    const createRoomOpts: ICreateRoomOpts = {
        name,
        topic,
        preset: Preset.PrivateChat, // 私有群組，不會自動開啟加密
        visibility: Visibility.Private, // 不公開在目錄中
        // 注意：不使用 invite 參數，因為跨服務器可能導致邀請失敗
        initial_state: initialState,
        power_level_content_override: powerLevelContentOverride,
        room_version: "10",
        creation_content: {
            "m.federate": true,
        },
    };

    console.log("[createGroupChat] Creating room with options:", JSON.stringify(createRoomOpts, null, 2));
    const result = await client.createRoom(createRoomOpts);
    const roomId = result.room_id;
    try {
        const createEvent = await client.getStateEvent(roomId, "m.room.create", "");
        const roomVersion = (createEvent as { room_version?: string } | null)?.room_version ?? "unknown";
        const federate = (createEvent as { [key: string]: unknown } | null)?.["m.federate"];
        console.log("[createGroupChat] Room created:", { roomId, roomVersion, federate });
    } catch (error) {
        console.warn("[createGroupChat] Failed to read room create event:", error);
    }

    // 確保房間不在目錄中可見
    await client.setRoomDirectoryVisibility(roomId, Visibility.Private);

    // 逐一邀請用戶，確保跨服務器邀請正確發送
    if (invitees.length > 0) {
        console.log("[createGroupChat] Inviting users one by one:", invitees);
        for (const invitee of invitees) {
            try {
                console.log("[createGroupChat] Inviting:", invitee);
                await client.invite(roomId, invitee);
                console.log("[createGroupChat] Successfully invited:", invitee);
            } catch (error) {
                console.error("[createGroupChat] Failed to invite:", invitee, error);
                // 繼續邀請其他用戶，不因單個失敗而中斷
            }
        }
    }

    return roomId;
}
