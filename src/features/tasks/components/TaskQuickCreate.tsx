import { useTranslation } from "react-i18next";
import type { TaskDraft, TaskStatus } from "../types";

type TaskQuickCreateProps = {
    open: boolean;
    draft: TaskDraft;
    statuses: TaskStatus[];
    onDraftChange: (patch: Partial<TaskDraft>) => void;
    onSave: () => void;
    onClose: () => void;
};

export function TaskQuickCreate({
    open,
    draft,
    statuses,
    onDraftChange,
    onSave,
    onClose,
}: TaskQuickCreateProps) {
    const { t } = useTranslation();
    if (!open) return null;

    return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
            <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("tasks.quickCreate")}</div>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                >
                    {t("common.close")}
                </button>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr,180px,220px,auto]">
                <input
                    type="text"
                    value={draft.title}
                    onChange={(event) => onDraftChange({ title: event.target.value })}
                    placeholder={t("tasks.placeholders.title")}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <select
                    value={draft.statusId}
                    onChange={(event) => onDraftChange({ statusId: event.target.value })}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                    {statuses.map((status) => (
                        <option key={status.id} value={status.id}>
                            {status.name}
                        </option>
                    ))}
                </select>
                <input
                    type="datetime-local"
                    value={draft.remindAt}
                    onChange={(event) => onDraftChange({ remindAt: event.target.value })}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                    type="button"
                    onClick={onSave}
                    className="rounded-lg bg-[#2F5C56] px-4 py-2 text-sm font-semibold text-white"
                >
                    {t("common.save")}
                </button>
            </div>
            <textarea
                value={draft.content}
                onChange={(event) => onDraftChange({ content: event.target.value })}
                rows={3}
                placeholder={t("tasks.placeholders.details")}
                className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
        </div>
    );
}
