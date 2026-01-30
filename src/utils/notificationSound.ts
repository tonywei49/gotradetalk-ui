/**
 * 通知音效播放器
 * 用於播放新消息到達時的提示音
 */

let audioContext: AudioContext | null = null;

/**
 * 播放通知音效
 * 使用 Web Audio API 生成簡單的提示音，避免需要外部音頻文件
 */
export function playNotificationSound(): void {
    try {
        // 懶加載 AudioContext
        if (!audioContext) {
            audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        }

        // 如果 AudioContext 被暫停（瀏覽器策略），嘗試恢復
        if (audioContext.state === "suspended") {
            void audioContext.resume();
        }

        // 創建振盪器生成提示音
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // 設置音調為柔和的提示音
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.type = "sine";

        // 設置音量包絡 - 快速淡入淡出
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.15);

        // 播放
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.15);
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
