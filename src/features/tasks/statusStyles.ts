import type { TaskStatusColor } from "./types";

const BADGE_CLASS_MAP: Record<TaskStatusColor, string> = {
    gray: "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
    amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
    blue: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
    red: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-200",
};

export function getTaskStatusBadgeClass(color: TaskStatusColor | undefined): string {
    return color ? BADGE_CLASS_MAP[color] : BADGE_CLASS_MAP.gray;
}
