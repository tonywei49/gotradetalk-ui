/**
 * 通知音效播放器
 * 用於播放新消息到達時的提示音
 */

let audioContext: AudioContext | null = null;
let audioUnlocked = false;
let audioElementUnlocked = false;
export type NotificationSoundMode = "off" | "classic" | "soft" | "chime";

const SOUND_FILE_MAP: Record<Exclude<NotificationSoundMode, "off">, string> = {
    classic: "/sounds/notification-classic.wav",
    soft: "/sounds/notification-soft.wav",
    chime: "/sounds/notification-chime.wav",
};

const audioElementCache = new Map<Exclude<NotificationSoundMode, "off">, HTMLAudioElement>();

function isTauriIosRuntime(): boolean {
    if (typeof window === "undefined") return false;
    const hasTauri = "__TAURI_INTERNALS__" in window;
    if (!hasTauri) return false;
    const ua = window.navigator.userAgent || "";
    return /iPhone|iPad|iPod/i.test(ua);
}

function getAudioContextConstructor(): typeof AudioContext | null {
    if (typeof window === "undefined") return null;
    return window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
}

function tryCreateAudioContext(): AudioContext | null {
    const AudioCtor = getAudioContextConstructor();
    if (!AudioCtor) return null;
    if (!audioContext) {
        audioContext = new AudioCtor();
    }
    return audioContext;
}

function getAudioElement(mode: Exclude<NotificationSoundMode, "off">): HTMLAudioElement | null {
    if (typeof window === "undefined") return null;
    const cached = audioElementCache.get(mode);
    if (cached) return cached;
    const audio = new Audio(SOUND_FILE_MAP[mode]);
    audio.preload = "auto";
    audio.volume = mode === "classic" ? 0.9 : mode === "soft" ? 0.6 : 0.75;
    audioElementCache.set(mode, audio);
    return audio;
}

async function tryPlayBundledSound(mode: Exclude<NotificationSoundMode, "off">): Promise<boolean> {
    const audio = getAudioElement(mode);
    if (!audio) return false;
    try {
        audio.currentTime = 0;
        await audio.play();
        return true;
    } catch {
        return false;
    }
}

export function ensureNotificationSoundEnabled(options?: { userInitiated?: boolean }): void {
    try {
        if (options?.userInitiated) {
            audioUnlocked = true;
            audioElementUnlocked = true;
        }
        if (isTauriIosRuntime() && !audioUnlocked) {
            return;
        }
        const context = tryCreateAudioContext();
        if (context && context.state === "suspended") {
            void context.resume();
        }
        if (audioElementUnlocked) {
            (Object.keys(SOUND_FILE_MAP) as Array<Exclude<NotificationSoundMode, "off">>).forEach((mode) => {
                getAudioElement(mode)?.load();
            });
        }
    } catch (error) {
        console.warn("Failed to enable notification sound:", error);
    }
}

/**
 * 播放通知音效
 * 桌面端優先使用內置音頻文件，失敗時回退到 Web Audio API 生成音效。
 */
export function playNotificationSound(mode: NotificationSoundMode = "classic"): void {
    try {
        if (mode === "off") return;
        if (isTauriIosRuntime() && !audioUnlocked) {
            return;
        }

        void (async () => {
            const played = await tryPlayBundledSound(mode);
            if (played) return;

            const context = tryCreateAudioContext();
            if (!context) return;
            if (context.state === "suspended") {
                void context.resume();
            }

            const now = context.currentTime;
            const playTone = (params: { frequency: number; type: OscillatorType; gain: number; attack: number; release: number; startAt: number }): void => {
                const osc = context.createOscillator();
                const gainNode = context.createGain();
                osc.connect(gainNode);
                gainNode.connect(context.destination);
                osc.type = params.type;
                osc.frequency.setValueAtTime(params.frequency, params.startAt);
                gainNode.gain.setValueAtTime(0, params.startAt);
                gainNode.gain.linearRampToValueAtTime(params.gain, params.startAt + params.attack);
                gainNode.gain.linearRampToValueAtTime(0, params.startAt + params.attack + params.release);
                osc.start(params.startAt);
                osc.stop(params.startAt + params.attack + params.release);
            };

            if (mode === "soft") {
                playTone({ frequency: 620, type: "sine", gain: 0.22, attack: 0.015, release: 0.22, startAt: now });
                return;
            }
            if (mode === "chime") {
                playTone({ frequency: 660, type: "triangle", gain: 0.18, attack: 0.01, release: 0.18, startAt: now });
                playTone({ frequency: 880, type: "triangle", gain: 0.14, attack: 0.01, release: 0.16, startAt: now + 0.11 });
                return;
            }
            playTone({ frequency: 800, type: "sine", gain: 0.34, attack: 0.01, release: 0.16, startAt: now });
        })().catch((error) => {
            console.warn("Failed to play notification sound:", error);
        });
    } catch (error) {
        console.warn("Failed to play notification sound:", error);
    }
}

/**
 * 檢查是否支持播放音效
 */
export function isNotificationSoundSupported(): boolean {
    return typeof window !== "undefined" &&
        (("AudioContext" in window || "webkitAudioContext" in window) || typeof Audio !== "undefined");
}
