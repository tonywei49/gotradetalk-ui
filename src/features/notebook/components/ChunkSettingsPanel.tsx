

export type ChunkSettings = {
    enabled: boolean;
    strategy: "smart" | "paragraph" | "heading" | "custom";
    chunkSize: number;
    separator: string;
};

export const defaultChunkSettings: ChunkSettings = {
    enabled: false,
    strategy: "smart",
    chunkSize: 1000,
    separator: "",
};

type ChunkSettingsPanelProps = {
    settings: ChunkSettings;
    onChange: (settings: ChunkSettings) => void;
};

export function ChunkSettingsPanel({ settings, onChange }: ChunkSettingsPanelProps) {
    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">自訂切片設定</span>
                <button
                    type="button"
                    onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings.enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                        }`}
                    role="switch"
                    aria-checked={settings.enabled}
                >
                    <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.enabled ? "translate-x-4" : "translate-x-0"
                            }`}
                    />
                </button>
            </div>
            {settings.enabled && (
                <div className="space-y-3 mt-3">
                    <div>
                        <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">切片方式</div>
                        <div className="flex flex-wrap gap-2">
                            {([
                                { value: "smart", label: "智能（默認）" },
                                { value: "paragraph", label: "段落（\\n\\n）" },
                                { value: "heading", label: "標題（##）" },
                                { value: "custom", label: "自訂" },
                            ] as const).map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => onChange({ ...settings, strategy: option.value })}
                                    className={`rounded-md border px-3 py-1 text-xs font-medium transition ${settings.strategy === option.value
                                        ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"
                                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
                                        }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {settings.strategy === "custom" && (
                        <div>
                            <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">自訂分隔符</div>
                            <input
                                type="text"
                                value={settings.separator}
                                onChange={(e) => onChange({ ...settings, separator: e.target.value })}
                                placeholder="例如: \n\n 或 ---"
                                className="w-full max-w-[280px] rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
                            />
                        </div>
                    )}
                    <div>
                        <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">每段字數：{settings.chunkSize}</div>
                        <input
                            type="range"
                            min={300}
                            max={2000}
                            step={50}
                            value={settings.chunkSize}
                            onChange={(e) => onChange({ ...settings, chunkSize: Number(e.target.value) })}
                            className="w-full max-w-[300px] accent-emerald-500"
                        />
                        <div className="flex justify-between text-[10px] text-slate-400 max-w-[300px]">
                            <span>300</span>
                            <span>2000</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
