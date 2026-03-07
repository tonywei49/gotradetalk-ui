import type { TaskDraft, TaskItem, TaskStatus } from "../types";
import { getTaskStatusBadgeClass } from "../statusStyles";

type TaskDetailProps = {
    task: TaskItem | null;
    statuses: TaskStatus[];
    draft: TaskDraft;
    editing: boolean;
    onDraftChange: (patch: Partial<TaskDraft>) => void;
    onStartEdit: () => void;
    onSave: () => void;
    onDelete: () => void;
    onMobileBack?: () => void;
    onOpenLinkedRoom?: (roomId: string) => void;
};

export function TaskDetail({
    task,
    statuses,
    draft,
    editing,
    onDraftChange,
    onStartEdit,
    onSave,
    onDelete,
    onMobileBack,
    onOpenLinkedRoom,
}: TaskDetailProps) {
    if (!task && !editing) {
        return (
            <div className="flex h-full items-center justify-center bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                Select a task to view details.
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-white dark:bg-slate-900">
            <div className="border-b border-gray-100 px-6 py-4 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    {onMobileBack ? (
                        <button
                            type="button"
                            onClick={onMobileBack}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                            aria-label="Back to task list"
                        >
                            &lt;
                        </button>
                    ) : null}
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {editing ? "Edit Task" : "Task Detail"}
                    </div>
                </div>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
                <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Title</div>
                    <input
                        type="text"
                        value={draft.title}
                        readOnly={!editing}
                        onChange={(event) => onDraftChange({ title: event.target.value })}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                </label>
                <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Content</div>
                    <textarea
                        value={draft.content}
                        readOnly={!editing}
                        onChange={(event) => onDraftChange({ content: event.target.value })}
                        rows={10}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                </label>
                <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Status</div>
                    <select
                        value={draft.statusId}
                        disabled={!editing}
                        onChange={(event) => onDraftChange({ statusId: event.target.value })}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                        {statuses.map((status) => (
                            <option key={status.id} value={status.id}>
                                {status.name}
                            </option>
                        ))}
                    </select>
                    {!editing ? (
                        <div className="mt-2">
                            <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${getTaskStatusBadgeClass(statuses.find((status) => status.id === draft.statusId)?.color)}`}>
                                {statuses.find((status) => status.id === draft.statusId)?.name || "Unknown"}
                            </span>
                        </div>
                    ) : null}
                </label>
                <label className="block">
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Reminder Time</div>
                    <input
                        type="datetime-local"
                        value={draft.remindAt}
                        disabled={!editing}
                        onChange={(event) => onDraftChange({ remindAt: event.target.value })}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                </label>
                {task?.roomNameSnapshot ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <div>Linked room: {task.roomNameSnapshot}</div>
                        {task.roomId && onOpenLinkedRoom ? (
                            <button
                                type="button"
                                onClick={() => onOpenLinkedRoom(task.roomId as string)}
                                className="mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
                            >
                                Open room
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-800">
                {!editing ? (
                    <button
                        type="button"
                        onClick={onStartEdit}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                    >
                        Edit
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={onSave}
                        className="rounded-lg bg-[#2F5C56] px-3 py-2 text-sm font-semibold text-white"
                    >
                        Save
                    </button>
                )}
                <button
                    type="button"
                    onClick={onDelete}
                    className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-600 dark:border-rose-700 dark:text-rose-300"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}
