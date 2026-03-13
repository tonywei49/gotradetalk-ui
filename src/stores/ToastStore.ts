import { create } from "zustand";

export type ToastType = "success" | "error" | "warn";
export type ToastPosition = "top-right" | "center";

export type ToastItem = {
    id: string;
    type: ToastType;
    message: string;
    position: ToastPosition;
};

export type { ToastState };

type ToastState = {
    toasts: ToastItem[];
    pushToast: (type: ToastType, message: string, durationMs?: number, position?: ToastPosition) => void;
    removeToast: (id: string) => void;
};

export const useToastStore = create<ToastState>((set) => ({
    toasts: [],
    pushToast: (type, message, durationMs = 3200, position = "top-right") => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        set((state) => ({ toasts: [...state.toasts, { id, type, message, position }] }));
        window.setTimeout(() => {
            set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
        }, durationMs);
    },
    removeToast: (id) => {
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
}));
