import { hubApiBaseUrl } from "../../config";

export type VoiceTaskStatus = "pending" | "processing" | "ready" | "failed";

export type VoiceTaskRecord = {
    voice_message_id: string;
    status: VoiceTaskStatus;
    playback_url: string | null;
    mime_type: string | null;
    duration_ms: number | null;
    error_code: string | null;
    error_message: string | null;
};

export class VoiceApiError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = "VoiceApiError";
        this.code = code;
    }
}

type CreateVoiceTaskParams = {
    accessToken: string;
    roomId: string;
    eventId: string;
    sourceMxc: string;
    durationMs?: number;
    mimeType?: string;
};

function buildVoiceUrl(path: string): string {
    return new URL(path, hubApiBaseUrl).toString();
}

async function parseVoiceJson<T>(response: Response): Promise<T> {
    const payload = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (!response.ok) {
        throw new VoiceApiError(payload?.code || "INTERNAL_ERROR", payload?.message || "Voice API request failed");
    }
    return payload as T;
}

export async function createVoiceTranscodeTask(params: CreateVoiceTaskParams): Promise<VoiceTaskRecord> {
    const response = await fetch(buildVoiceUrl("/voice/messages/transcode"), {
        method: "POST",
        headers: {
            Authorization: `Bearer ${params.accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            room_id: params.roomId,
            event_id: params.eventId,
            source_mxc: params.sourceMxc,
            duration_ms: params.durationMs,
            mime_type: params.mimeType,
        }),
    });
    return parseVoiceJson<VoiceTaskRecord>(response);
}

export async function getVoiceTaskStatus(accessToken: string, voiceMessageId: string): Promise<VoiceTaskRecord> {
    const response = await fetch(buildVoiceUrl(`/voice/messages/${encodeURIComponent(voiceMessageId)}/status`), {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
    return parseVoiceJson<VoiceTaskRecord>(response);
}

export async function fetchVoicePlaybackBlob(
    accessToken: string,
    playbackUrl: string,
): Promise<{ blob: Blob; objectUrl: string }> {
    const response = await fetch(playbackUrl, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
    if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
        throw new VoiceApiError(payload?.code || "INTERNAL_ERROR", payload?.message || "Voice playback request failed");
    }
    const blob = await response.blob();
    return {
        blob,
        objectUrl: URL.createObjectURL(blob),
    };
}
