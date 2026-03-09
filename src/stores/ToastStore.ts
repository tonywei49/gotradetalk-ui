import { create } from "zustand";

export type ToastType = "success" | "error" | "warn";

export type ToastItem = {
    id: string;
    type: ToastType;
    message: string;
};

export type { ToastState };

type ToastState = {
    toasts: ToastItem[];
    pushToast: (type: ToastType, message: string, durationMs?: number) => void;
    removeToast: (id: string) => void;
};

export const useToastStore = create<ToastState>((set) => ({
    toasts: [],
    pushToast: (type, message, durationMs = 3200) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
        window.setTimeout(() => {
            set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
        }, durationMs);
    },
    removeToast: (id) => {
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
}));
