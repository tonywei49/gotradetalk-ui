import React from "react";
import { useToastStore } from "../stores/ToastStore";

function toastClass(type: "success" | "error" | "warn"): string {
    if (type === "success") return "border-emerald-300 bg-emerald-50 text-emerald-800";
    if (type === "warn") return "border-amber-300 bg-amber-50 text-amber-800";
    return "border-rose-300 bg-rose-50 text-rose-800";
}

export const ToastViewport: React.FC = () => {
    const toasts = useToastStore((state) => state.toasts);
    const removeToast = useToastStore((state) => state.removeToast);

    if (toasts.length === 0) return null;

    return (
        <div className="pointer-events-none fixed right-4 top-4 z-[120] flex max-w-sm flex-col gap-2">
            {toasts.map((toast) => (
                <button
                    key={toast.id}
                    type="button"
                    data-testid="toast-item"
                    onClick={() => removeToast(toast.id)}
                    className={`pointer-events-auto w-full rounded-xl border px-3 py-2 text-left text-sm shadow-md transition hover:opacity-90 ${toastClass(toast.type)}`}
                >
                    {toast.message}
                </button>
            ))}
        </div>
    );
};

