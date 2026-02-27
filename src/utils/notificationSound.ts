/**
 * 通知音效播放器
 * 用於播放新消息到達時的提示音
 */

let audioContext: AudioContext | null = null;
export type NotificationSoundMode = "off" | "classic" | "soft" | "chime";

export function ensureNotificationSoundEnabled(): void {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        }
        if (audioContext.state === "suspended") {
            void audioContext.resume();
        }
    } catch (error) {
        console.warn("Failed to enable notification sound:", error);
    }
}

/**
 * 播放通知音效
 * 使用 Web Audio API 生成簡單的提示音，避免需要外部音頻文件
 */
export function playNotificationSound(mode: NotificationSoundMode = "classic"): void {
    try {
        if (mode === "off") return;
        // 懶加載 AudioContext
        if (!audioContext) {
            audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        }

        // 如果 AudioContext 被暫停（瀏覽器策略），嘗試恢復
        if (audioContext.state === "suspended") {
            void audioContext.resume();
        }

        const now = audioContext.currentTime;
        const playTone = (params: { frequency: number; type: OscillatorType; gain: number; attack: number; release: number; startAt: number }): void => {
            const oscillator = audioContext as AudioContext;
            const osc = oscillator.createOscillator();
            const gainNode = oscillator.createGain();
            osc.connect(gainNode);
            gainNode.connect(oscillator.destination);
            osc.type = params.type;
            osc.frequency.setValueAtTime(params.frequency, params.startAt);
            gainNode.gain.setValueAtTime(0, params.startAt);
            gainNode.gain.linearRampToValueAtTime(params.gain, params.startAt + params.attack);
            gainNode.gain.linearRampToValueAtTime(0, params.startAt + params.attack + params.release);
            osc.start(params.startAt);
            osc.stop(params.startAt + params.attack + params.release);
        };

        if (mode === "soft") {
            playTone({ frequency: 620, type: "sine", gain: 0.16, attack: 0.015, release: 0.18, startAt: now });
            return;
        }
        if (mode === "chime") {
            playTone({ frequency: 660, type: "triangle", gain: 0.14, attack: 0.01, release: 0.16, startAt: now });
            playTone({ frequency: 880, type: "triangle", gain: 0.1, attack: 0.01, release: 0.14, startAt: now + 0.11 });
            return;
        }
        // classic
        playTone({ frequency: 800, type: "sine", gain: 0.26, attack: 0.01, release: 0.14, startAt: now });
    } catch (error) {
        // 靜默失敗 - 某些瀏覽器可能不支持 Web Audio API
        console.warn("Failed to play notification sound:", error);
    }
}

/**
 * 檢查是否支持播放音效
 */
export function isNotificationSoundSupported(): boolean {
    return typeof window !== "undefined" &&
        ("AudioContext" in window || "webkitAudioContext" in window);
}
