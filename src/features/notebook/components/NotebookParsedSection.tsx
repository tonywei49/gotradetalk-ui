import { useMemo, useState } from "react";
import type { NotebookChunk, NotebookParsedPreview } from "../types";
import { NOTEBOOK_CHUNKS_PAGE_SIZE } from "../constants";

type NotebookParsedSectionProps = {
    previewBusy: boolean;
    previewError: string | null;
    parsedPreview: NotebookParsedPreview | null;
    chunks: NotebookChunk[];
    chunksTotal: number;
};

export function NotebookParsedSection({
    previewBusy,
    previewError,
    parsedPreview,
    chunks,
    chunksTotal,
}: NotebookParsedSectionProps) {
    const [chunkPage, setChunkPage] = useState(1);

    const chunkPageCount = useMemo(() => {
        const total = Math.max(chunks.length, chunksTotal);
        return Math.max(1, Math.ceil(total / NOTEBOOK_CHUNKS_PAGE_SIZE));
    }, [chunks.length, chunksTotal]);

    const chunkPageSafe = Math.min(chunkPage, chunkPageCount);
    const visibleChunks = useMemo(() => {
        const start = (chunkPageSafe - 1) * NOTEBOOK_CHUNKS_PAGE_SIZE;
        return (chunks || []).slice(start, start + NOTEBOOK_CHUNKS_PAGE_SIZE);
    }, [chunkPageSafe, chunks]);

    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <div className="mb-2 font-semibold">Parsed preview & chunks</div>
            {previewBusy ? (
                <div className="text-slate-500 dark:text-slate-400">Loading parsed result...</div>
            ) : previewError ? (
                <div className="text-rose-600 dark:text-rose-300">{previewError}</div>
            ) : !parsedPreview ? (
                <div className="text-slate-500 dark:text-slate-400">No parsed result yet.</div>
            ) : (
                <div className="space-y-2">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Total chunks: {parsedPreview.chunkCountTotal} · Sampled: {parsedPreview.chunkCountSampled} · Chars: {parsedPreview.totalChars} · Tokens: {parsedPreview.totalTokens}
                    </div>
                    <textarea
                        readOnly
                        value={parsedPreview.text || ""}
                        rows={8}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-2 text-[12px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <div className="space-y-2">
                        {visibleChunks.map((chunk) => (
                            <div key={chunk.id} className="rounded border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                                <div className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    #{chunk.chunkIndex} · {chunk.sourceType || "unknown"} {chunk.sourceLocator ? `· ${chunk.sourceLocator}` : ""}
                                </div>
                                <div className="max-h-24 overflow-auto whitespace-pre-wrap text-[12px] text-slate-700 dark:text-slate-100">
                                    {chunk.chunkText}
                                </div>
                            </div>
                        ))}
                        {Math.max(chunks.length, chunksTotal) > NOTEBOOK_CHUNKS_PAGE_SIZE && (
                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                                <div>
                                    Page {chunkPageSafe}/{chunkPageCount} · Total {Math.max(chunks.length, chunksTotal)} chunks
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setChunkPage((prev) => Math.max(1, prev - 1))}
                                        disabled={chunkPageSafe <= 1}
                                        className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50 dark:border-slate-600"
                                    >
                                        Prev
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setChunkPage((prev) => Math.min(chunkPageCount, prev + 1))}
                                        disabled={chunkPageSafe >= chunkPageCount}
                                        className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50 dark:border-slate-600"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
